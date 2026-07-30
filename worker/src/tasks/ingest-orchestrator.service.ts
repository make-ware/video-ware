import { Injectable, Logger } from '@nestjs/common';
import {
  ALL_LABEL_DETECTIONS,
  buildIngestTranscodeConfig,
  MediaType,
  ProcessingProvider,
  TaskOrigin,
  TaskStatus,
  type Task,
  type MediaInput,
  type ProbeOutput,
  type ProcessUploadPayload,
  type DetectLabelsPayload,
  type TranscodeFlowConfig,
  type LabelsFlowConfig,
} from '@project/shared';
import { PocketBaseService } from '../shared/services/pocketbase.service';
import { QueueService } from '../queue/queue.service';

/**
 * IngestOrchestratorService owns the application logic that used to live in the
 * webapp (shared `UploadMutator.processUploadAndDetectLabels`). It is triggered
 * by a lightweight PocketBase hook that creates a single `full_ingest` Task when
 * an Upload reaches `uploaded`. The worker picks that task up via the existing
 * poll loop and this service:
 *   1. resolves the Upload,
 *   2. idempotently creates the placeholder Media record,
 *   3. builds the default transcode/labels config, and
 *   4. fans out the `process_upload` (transcode) and `detect_labels` tasks,
 *      enqueuing them immediately so they don't wait for another poll tick.
 *
 * The `full_ingest` task owns its own status (queued -> running -> success/failed);
 * the generic enqueue/claim path is bypassed for it, so this service claims the
 * task (-> running) up front to drop it out of the poll loop's queued set and
 * avoid duplicate orchestration under more than one worker.
 */
@Injectable()
export class IngestOrchestratorService {
  private readonly logger = new Logger(IngestOrchestratorService.name);

  constructor(
    private readonly pocketbaseService: PocketBaseService,
    private readonly queueService: QueueService
  ) {}

  async orchestrate(task: Task): Promise<void> {
    const payload = (task.payload ?? {}) as { uploadId?: string };
    const uploadId = payload.uploadId ?? (task.sourceId as string);

    try {
      // Claim the task (queued -> running) before doing any work. full_ingest is
      // orchestrated in-process with no BullMQ job (so no jobId dedup), and the
      // poll loop selects tasks by `status = queued`. Leaving it queued for the
      // whole (multi-second) orchestration lets every poll tick of every worker
      // re-dispatch it and fan out duplicate transcode/labels child tasks. Marking
      // it running here drops it out of the queued set immediately. Best-effort:
      // if this fails the orchestration below would fail too, so just log and go.
      try {
        await this.pocketbaseService.updateTask(task.id, {
          status: TaskStatus.RUNNING,
        });
      } catch (claimError) {
        this.logger.warn(
          `Failed to claim full_ingest task ${task.id} (continuing): ${
            claimError instanceof Error
              ? claimError.message
              : String(claimError)
          }`
        );
      }

      if (!uploadId) {
        throw new Error('full_ingest task is missing uploadId');
      }

      const upload = await this.pocketbaseService.getUpload(uploadId);
      if (!upload) {
        throw new Error(`Upload not found: ${uploadId}`);
      }

      // Detect media type from extension
      const isAudio = /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(upload.name);
      const isImage = /\.(jpe?g|png|gif|webp)$/i.test(upload.name);
      const mediaType = isImage
        ? MediaType.IMAGE
        : isAudio
          ? MediaType.AUDIO
          : MediaType.VIDEO;

      // Idempotent placeholder Media (reused on re-ingest/retry)
      let media = await this.pocketbaseService.getMediaByUpload(uploadId);
      const reusedMedia = media !== null;
      if (!media) {
        // Placeholder probe output: only the fields ProbeOutputSchema requires,
        // all zeroed. The PROBE step overwrites the whole column with real
        // values, and empty `video`/`audio` blocks would misreport an
        // audio-only or silent file until it did.
        const dummyMediaData: ProbeOutput = {
          width: 0,
          height: 0,
          duration: 0,
          codec: '',
          format: '',
          fps: 0,
        };

        const mediaInput: MediaInput = {
          WorkspaceRef: upload.WorkspaceRef as string,
          UploadRef: uploadId,
          mediaType,
          // Denormalized source file name — see Media.name in shared/schema.
          name: upload.name,
          mediaDate: new Date().toISOString(),
          duration: 0,
          width: 0,
          height: 0,
          aspectRatio: 0,
          mediaData: dummyMediaData,
          hasAudio: true,
          isActive: false,
          version: 1,
          ...(upload.DirectoryRef
            ? { DirectoryRef: upload.DirectoryRef as string }
            : {}),
        };

        media = await this.pocketbaseService.createMedia(mediaInput);
      }

      if (!media) {
        throw new Error('Failed to create or retrieve media record');
      }

      // Re-ingest of an EXISTING Media (retry, or a media ingested before
      // Media.name existed): re-sync the denormalized file name. A media is
      // (re)derived from its upload here, so this is the one place the copy
      // can drift back into agreement. Editors override the display name via
      // `label`, which this never touches. Best-effort — a failure to write a
      // cosmetic field must not fail the ingest.
      if (reusedMedia && upload.name && media.name !== upload.name) {
        try {
          await this.pocketbaseService.updateMedia(media.id, {
            name: upload.name,
          });
        } catch (nameError) {
          this.logger.warn(
            `Failed to sync name onto media ${media.id} (continuing): ${
              nameError instanceof Error ? nameError.message : String(nameError)
            }`
          );
        }
      }

      // Geometry (and the media-type gating behind it) comes from the shared
      // ingest spec, so ingest, the webapp's regenerate, `vw job transcode` and
      // the weekly backfill all request identical assets. Change it there.
      const defaultTranscode: TranscodeFlowConfig = {
        provider: ProcessingProvider.FFMPEG,
        ...buildIngestTranscodeConfig(mediaType),
      };

      // Request every detector. This is an *intent* layer, not the on/off
      // switch: LabelsFlowBuilder gates each step by `ENABLE_* env AND this
      // config` (see worker/src/queue/flows/labels-flow.builder.ts), sourcing
      // the env side from ProcessorsConfigService. So the deployment's ENABLE_*
      // flags decide what actually runs; setting these false here would veto
      // detection regardless of env. ALL_LABEL_DETECTIONS is the single source
      // of truth for "run everything" (shared with the webapp Detect Labels
      // button) and is `Required`, so a new detector forces this to update.
      const defaultLabels: LabelsFlowConfig = {
        confidenceThreshold: 0.5,
        ...ALL_LABEL_DETECTIONS,
      };

      const processPayload: ProcessUploadPayload = {
        uploadId,
        mediaId: media.id,
        origin: TaskOrigin.INGEST,
        ...defaultTranscode,
        labels: { ...defaultLabels },
      };

      const workspaceRef = upload.WorkspaceRef as string;
      const userRef = (task.UserRef as string) || (upload.UserRef as string);

      const childTasks: Task[] = [];

      // Transcode (process_upload) task
      const transcodeTask =
        await this.pocketbaseService.taskMutator.createProcessUploadTask(
          workspaceRef,
          userRef,
          uploadId,
          processPayload
        );
      childTasks.push(transcodeTask);

      // Label detection task (parallel) — skip for images (no temporal content)
      // and when the original file path isn't known yet.
      if (upload.externalPath && !isImage) {
        const labelsPayload: DetectLabelsPayload = {
          mediaId: media.id,
          fileRef: upload.externalPath as string,
          provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          config: { ...defaultLabels },
        };

        const labelsTask =
          await this.pocketbaseService.taskMutator.createDetectLabelsTask(
            workspaceRef,
            userRef,
            media.id,
            labelsPayload
          );
        childTasks.push(labelsTask);
      }

      // Enqueue the children right away so they don't wait for the next poll
      // tick. BullMQ jobId dedup + the poll loop are the safety net if a child
      // fails to enqueue here.
      for (const child of childTasks) {
        try {
          await this.queueService.enqueueTask(child);
          await this.pocketbaseService.updateTask(child.id, {
            status: TaskStatus.RUNNING,
          });
        } catch (childError) {
          // Leave the child queued; the poll loop will pick it up.
          this.logger.warn(
            `Deferred enqueue of child task ${child.id} to poll loop: ${
              childError instanceof Error
                ? childError.message
                : String(childError)
            }`
          );
        }
      }

      await this.pocketbaseService.taskMutator.markSuccess(task.id, {
        uploadId,
        mediaId: media.id,
        childTaskIds: childTasks.map((t) => t.id),
      });

      this.logger.log(
        `Ingest orchestrated for upload ${uploadId}: media ${media.id}, ${childTasks.length} child task(s)`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Ingest orchestration failed for task ${task.id}: ${message}`
      );
      try {
        await this.pocketbaseService.taskMutator.markFailed(task.id, message);
      } catch {
        // Best-effort; the task stays running and the poll loop won't retry it.
      }
    }
  }
}
