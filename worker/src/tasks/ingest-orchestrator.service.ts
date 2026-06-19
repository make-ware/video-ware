import { Injectable, Logger } from '@nestjs/common';
import {
  MediaType,
  ProcessingProvider,
  TaskStatus,
  type Task,
  type MediaInput,
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
 * The `full_ingest` task owns its own status (running -> success/failed); the
 * generic enqueue/claim path is bypassed for it.
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
      if (!media) {
        const dummyMediaData = {
          width: 0,
          height: 0,
          duration: 0,
          bitrate: 0,
          codec: '',
          format: '',
          fps: 0,
          size: 0,
          mediaDate: new Date().toISOString(),
          video: {
            codec: '',
            profile: '',
            width: 0,
            height: 0,
            pixFmt: '',
            level: '',
            colorSpace: '',
          },
          audio: {
            bitrate: 0,
            channels: 0,
            codec: '',
            sampleRate: '0',
          },
        };

        const mediaInput: MediaInput = {
          WorkspaceRef: upload.WorkspaceRef as string,
          UploadRef: uploadId,
          mediaType,
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

      const defaultTranscode: TranscodeFlowConfig = {
        provider: ProcessingProvider.FFMPEG,
        sprite: isAudio
          ? undefined
          : isImage
            ? {
                fps: 1,
                cols: 1,
                rows: 1,
                tileWidth: 320,
                tileHeight: 180,
              }
            : {
                fps: 1,
                cols: 10,
                rows: 10,
                tileWidth: 320,
                tileHeight: 180,
              },
        thumbnail: isAudio
          ? undefined
          : {
              timestamp: 'midpoint',
              width: 640,
              height: 360,
            },
        filmstrip:
          isAudio || isImage
            ? undefined
            : {
                cols: 100,
                rows: 1,
                tileWidth: 320,
                tileHeight: 180,
              },
        transcode: {
          enabled: !isAudio && !isImage,
          // Proxy is the web-playable preview; H.264 has universal browser
          // support, whereas H.265/HEVC fails to decode in most browsers
          // (NotSupportedError on play()). Keep in sync with the regenerate
          // path in webapp/src/services/media.ts.
          codec: 'h264',
          resolution: '720p',
        },
        audio: {
          enabled: !isImage,
          bitrate: '128k',
        },
      };

      // Request every detector. This is an *intent* layer, not the on/off
      // switch: LabelsFlowBuilder gates each step by `ENABLE_* env AND this
      // config` (see worker/src/queue/flows/labels-flow.builder.ts), sourcing
      // the env side from ProcessorsConfigService. So the deployment's ENABLE_*
      // flags decide what actually runs; setting these false here would veto
      // detection regardless of env. Keep in sync with the regenerate default
      // in webapp/src/services/media.ts.
      const defaultLabels: LabelsFlowConfig = {
        confidenceThreshold: 0.5,
        detectObjects: true,
        detectLabels: true,
        detectFaces: true,
        detectPersons: true,
        detectSpeech: true,
      };

      const processPayload: ProcessUploadPayload = {
        uploadId,
        mediaId: media.id,
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
