import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { ProcessingProvider, FileStatus, type Media } from '@project/shared';
import { LabelCacheService } from '../services/label-cache.service';
import { LabelEntityService } from '../services/label-entity.service';
import { SpeakerTranscriptionExecutor } from '../executors/speaker-transcription.executor';
import { SpeakerTranscriptionNormalizer } from '../normalizers/speaker-transcription.normalizer';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { StorageService } from '../../shared/services/storage.service';
import type { StepJobData } from '../../queue/types/job.types';
import type { SpeakerTranscriptionStepInput } from '../types/step-inputs';
import type { SpeakerTranscriptionStepOutput } from '../types/step-outputs';
import type { SpeakerTranscriptionResponse } from '../types/executor-responses';
import type {
  LabelTrackData,
  LabelSpeakerData,
} from '../types/normalizer-outputs';

// Re-export types for parent processor
export type { SpeakerTranscriptionStepInput, SpeakerTranscriptionStepOutput };

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * Total window and poll interval for the in-process wait on the transcode
 * outputs (see waitForAudioReadiness). Read from the environment on each call
 * so deployments can tune them without a rebuild.
 */
const AUDIO_READY_WAIT_MS_DEFAULT = 120_000;
const AUDIO_READY_POLL_MS_DEFAULT = 3_000;

/**
 * Step processor for SPEAKER_TRANSCRIPTION in detect_labels flow
 *
 * This processor:
 * 1. Checks cache before calling executor
 * 2. Calls SpeakerTranscriptionExecutor (ElevenLabs Scribe, diarize: true),
 *    preferring the transcode audio proxy (Media.audioFileRef) over the
 *    original file
 * 3. Calls SpeakerTranscriptionNormalizer to transform response
 * 4. Batch inserts LabelEntity records (one per speaker)
 * 5. Batch inserts LabelTrack records (one per speaker)
 * 6. Batch inserts LabelSpeaker records (per-utterance, word-precise timing)
 * 7. Stores normalized response to cache
 */
@Injectable()
export class SpeakerTranscriptionStepProcessor extends BaseStepProcessor<
  SpeakerTranscriptionStepInput,
  SpeakerTranscriptionStepOutput
> {
  protected readonly logger = new Logger(
    SpeakerTranscriptionStepProcessor.name
  );
  private readonly processorVersion = 'speaker-transcription:1.0.0';

  constructor(
    private readonly labelCacheService: LabelCacheService,
    private readonly labelEntityService: LabelEntityService,
    private readonly speakerTranscriptionExecutor: SpeakerTranscriptionExecutor,
    private readonly speakerTranscriptionNormalizer: SpeakerTranscriptionNormalizer,
    private readonly pocketBaseService: PocketBaseService,
    private readonly storageService: StorageService
  ) {
    super();
  }

  /**
   * Process speaker transcription with cache awareness
   */
  async process(
    input: SpeakerTranscriptionStepInput,
    _job: Job<StepJobData>
  ): Promise<SpeakerTranscriptionStepOutput> {
    const startTime = Date.now();

    this.logger.log(
      `Processing speaker transcription for media ${input.mediaId}, version ${input.version}`
    );

    try {
      // Step 0: Wait (bounded, in-process) for the transcode task to determine
      // audio presence (PROBE) and produce the audio-only proxy (AUDIO ->
      // Media.audioFileRef) before deciding. Keeps the labels and transcode
      // tasks decoupled (no cross-task dependency) while ensuring we neither
      // run speaker detection on silent media nor upload the full original
      // file to ElevenLabs when a small audio proxy is moments away.
      const { decision, media } = await this.waitForAudioReadiness(
        input.mediaId
      );
      if (decision === 'skip') {
        this.logger.log(
          `Media ${input.mediaId} has no audio track, skipping speaker transcription`
        );
        return {
          success: true,
          cacheHit: false,
          processorVersion: this.processorVersion,
          processingTimeMs: Date.now() - startTime,
          counts: {
            transcriptLength: 0,
            wordCount: 0,
            speakerCount: 0,
            labelEntityCount: 0,
            labelTrackCount: 0,
            labelClipCount: 0,
            labelObjectCount: 0,
            labelFaceCount: 0,
            labelPersonCount: 0,
            labelSpeechCount: 0,
            labelSpeakerCount: 0,
            labelSegmentCount: 0,
            labelShotCount: 0,
          },
        };
      }

      // Step 1: Check cache before calling executor
      const cached = await this.labelCacheService.getCachedLabels(
        input.workspaceRef,
        input.mediaId,
        input.version,
        ProcessingProvider.ELEVENLABS,
        this.processorVersion
      );

      let response: unknown;
      let cacheHit = false;

      if (
        cached &&
        this.labelCacheService.isCacheValid(cached, this.processorVersion)
      ) {
        this.logger.log(
          `Using cached speaker transcription for media ${input.mediaId}`
        );
        response = cached.response;
        cacheHit = true;
      } else {
        // Step 2: Cache miss - call executor
        this.logger.log(
          `Cache miss for media ${input.mediaId}, calling ElevenLabs STT API`
        );

        // Lease the media temp dir across BOTH the proxy download and the
        // executor's provider upload, so a concurrent sibling step's
        // cleanupTemp can't delete the proxy in the gap between the two.
        response = await this.storageService.withTempLease(
          input.mediaId,
          async () => {
            // Prefer the audio-only proxy rendered by the transcode task
            // (Media.audioFileRef). Resolves to undefined on any issue, in
            // which case the executor uses the original file (input.fileRef).
            const audioProxyPath = await this.resolveAudioProxy(media);

            return this.speakerTranscriptionExecutor.execute(
              input.workspaceRef,
              input.mediaId,
              input.fileRef,
              input.config,
              audioProxyPath
            );
          }
        );

        // Step 7: Store normalized response to cache
        await this.labelCacheService.storeLabelCache(
          input.workspaceRef,
          input.mediaId,
          input.version,
          ProcessingProvider.ELEVENLABS,
          response,
          this.processorVersion,
          ['SPEAKER_TRANSCRIPTION']
        );

        this.logger.log(
          `Speaker transcription completed for media ${input.mediaId}, stored to cache`
        );
      }

      // Step 3: Call normalizer to transform response
      const normalizedData =
        await this.speakerTranscriptionNormalizer.normalize({
          response: response as SpeakerTranscriptionResponse,
          mediaId: input.mediaId,
          workspaceRef: input.workspaceRef,
          taskRef: input.taskRef,
          version: input.version,
          processor: 'speaker-transcription',
          processorVersion: this.processorVersion,
        });

      // Step 4: Batch insert LabelEntity records
      // Map provider speaker ids to entity IDs
      const entityMap = new Map<string, string>();
      for (const entity of normalizedData.labelEntities) {
        const entityId = await this.labelEntityService.getOrCreateLabelEntity(
          entity.WorkspaceRef,
          entity.labelType,
          entity.canonicalName,
          entity.provider as ProcessingProvider.ELEVENLABS,
          entity.processor,
          entity.metadata
        );
        const speakerId =
          (entity.metadata as { speakerId?: string })?.speakerId ?? '';
        entityMap.set(speakerId, entityId);
      }
      this.logger.debug(`Processed ${entityMap.size} speaker entities`);

      // Step 5: Batch insert LabelTrack records
      // Link tracks to entities
      const trackMap = new Map<string, string>();
      const tracksToInsert = (normalizedData.labelTracks || []).map((track) => {
        const speakerId =
          (track.trackData as { speakerId?: string })?.speakerId ?? '';
        return {
          ...track,
          LabelEntityRef: entityMap.get(speakerId),
        };
      });

      const trackIds = await this.batchInsertLabelTracks(tracksToInsert);

      // Map speaker ids to track IDs (using tracksToInsert to maintain order)
      tracksToInsert.forEach((track, index) => {
        const speakerId =
          (track.trackData as { speakerId?: string })?.speakerId ?? '';
        if (trackIds[index]) {
          trackMap.set(speakerId, trackIds[index]);
        }
      });
      this.logger.debug(`Inserted ${trackIds.length} speaker tracks`);

      // Step 6: Batch insert LabelSpeaker records
      // Link utterances to entities and tracks
      const speakersToInsert = (normalizedData.labelSpeakers || []).map(
        (speaker) => ({
          ...speaker,
          LabelEntityRef: entityMap.get(speaker.speakerId),
          LabelTrackRef: trackMap.get(speaker.speakerId),
        })
      );

      const speakerIds = await this.batchInsertLabelSpeakers(speakersToInsert);
      this.logger.debug(`Inserted ${speakerIds.length} speaker utterances`);

      // Clear entity cache after processing
      this.labelEntityService.clearCache();

      const processingTimeMs = Date.now() - startTime;

      return {
        success: true,
        cacheHit,
        processorVersion: this.processorVersion,
        processingTimeMs,
        counts: {
          transcriptLength:
            normalizedData.labelMediaUpdate.transcriptLength || 0,
          wordCount: normalizedData.labelMediaUpdate.wordCount || 0,
          speakerCount: normalizedData.labelMediaUpdate.speakerCount || 0,
          labelEntityCount: entityMap.size,
          labelTrackCount: trackIds.length,
          labelClipCount: 0,
          labelObjectCount: 0,
          labelFaceCount: 0,
          labelPersonCount: 0,
          labelSpeechCount: 0,
          labelSpeakerCount: speakerIds.length,
          labelSegmentCount: 0,
          labelShotCount: 0,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Speaker transcription failed for media ${input.mediaId}: ${errorMessage}`
      );

      // Rethrow so processStepJob produces a status: 'failed' StepResult.
      // Swallowing this into a success:false output makes the parent's
      // partial-success accounting count a failed step as completed.
      throw error;
    }
  }

  /**
   * Wait (in-process, bounded by AUDIO_READY_WAIT_MS) for the transcode task to
   * produce the two facts this step depends on, then return a decision:
   *   - 'skip'    -> PROBE has run and the media has no audio track;
   *   - 'proceed' -> PROBE has run, audio is present, and the audio proxy
   *                  (Media.audioFileRef) is AVAILABLE.
   *
   * `hasAudio` is only authoritative once PROBE has run. The ingest placeholder
   * Media is created with hasAudio:true and duration:0, and PROBE writes a real
   * duration for every video/audio file (images never reach this step), so
   * `duration > 0` is our "PROBE has run" signal.
   *
   * On timeout it returns 'proceed' regardless; resolveAudioProxy() will then
   * find no available proxy and the executor falls back to the original upload.
   */
  private async waitForAudioReadiness(
    mediaId: string
  ): Promise<{ decision: 'skip' | 'proceed'; media: Media }> {
    const waitMs = parsePositiveInt(
      process.env.SPEAKER_TRANSCRIPTION_AUDIO_WAIT_MS,
      AUDIO_READY_WAIT_MS_DEFAULT
    );
    const pollMs = parsePositiveInt(
      process.env.SPEAKER_TRANSCRIPTION_AUDIO_POLL_MS,
      AUDIO_READY_POLL_MS_DEFAULT
    );
    const deadline = Date.now() + waitMs;
    let media = await this.pocketBaseService.getMedia(mediaId);
    let waitLogged = false;

    for (;;) {
      const probeComplete = media.duration > 0;

      if (probeComplete) {
        if (media.hasAudio === false) {
          return { decision: 'skip', media };
        }
        if (await this.isAudioProxyAvailable(media)) {
          return { decision: 'proceed', media };
        }
      }

      if (Date.now() >= deadline) {
        this.logger.warn(
          `Audio proxy for media ${mediaId} not ready after ${waitMs}ms ` +
            `(probeComplete=${probeComplete}, hasAudio=${media.hasAudio}); ` +
            `proceeding, executor will fall back to the original upload`
        );
        return { decision: 'proceed', media };
      }

      if (!waitLogged) {
        this.logger.debug(
          `Waiting for transcode audio proxy for media ${mediaId} (probeComplete=${probeComplete})`
        );
        waitLogged = true;
      }

      await this.sleep(pollMs);
      media = await this.pocketBaseService.getMedia(mediaId);
    }
  }

  /**
   * Cheap readiness probe for the audio-only proxy: the ref must be set and its
   * File record AVAILABLE with a stored blob. Does NOT download (that happens
   * in resolveAudioProxy once we commit to running).
   */
  private async isAudioProxyAvailable(media: Media): Promise<boolean> {
    if (!media.audioFileRef) {
      return false;
    }
    try {
      const file = await this.pocketBaseService.getFile(media.audioFileRef);
      return !!file && file.fileStatus === FileStatus.AVAILABLE && !!file.file;
    } catch {
      return false;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Resolve the transcode-generated audio-only proxy (Media.audioFileRef) to
   * a local temp file for the executor to upload.
   *
   * Returns undefined on any issue (missing ref, File record not AVAILABLE,
   * download failure, empty file) so the caller falls back to the original
   * file. The download lands in the media's worker-temp directory, which the
   * executor removes via cleanupTemp() when the step finishes.
   */
  private async resolveAudioProxy(media: Media): Promise<string | undefined> {
    if (!media.audioFileRef) {
      return undefined;
    }

    try {
      const file = await this.pocketBaseService.getFile(media.audioFileRef);
      if (!file) {
        this.logger.warn(
          `Audio proxy file record ${media.audioFileRef} not found for media ${media.id}, falling back to original file`
        );
        return undefined;
      }

      if (file.fileStatus !== FileStatus.AVAILABLE || !file.file) {
        this.logger.warn(
          `Audio proxy file ${file.id} for media ${media.id} is not available (status: ${file.fileStatus}), falling back to original file`
        );
        return undefined;
      }

      const tempDir = await this.storageService.createTempDir(media.id);
      // Prefix with the File id so the proxy can never collide with the
      // original's temp download in the same directory.
      const destPath = path.join(tempDir, `${file.id}-${file.name || 'audio'}`);
      await this.pocketBaseService.downloadFileToPath(file, destPath);

      const stat = await fs.promises.stat(destPath);
      if (stat.size === 0) {
        this.logger.warn(
          `Audio proxy file ${file.id} for media ${media.id} downloaded empty, falling back to original file`
        );
        return undefined;
      }

      this.logger.log(
        `Resolved audio proxy for media ${media.id}: ${destPath} (${stat.size} bytes)`
      );
      return destPath;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to resolve audio proxy for media ${media.id}, falling back to original file: ${message}`
      );
      return undefined;
    }
  }

  /**
   * Batch insert LabelTrack records
   */
  private async batchInsertLabelTracks(
    tracks: LabelTrackData[]
  ): Promise<string[]> {
    const trackIds: string[] = [];
    for (const track of tracks) {
      try {
        const existing = await this.pocketBaseService.labelTrackMutator.getList(
          1,
          1,
          `trackHash = "${track.trackHash}"`
        );
        if (existing.items.length > 0) {
          trackIds.push(existing.items[0].id);
        } else {
          const created =
            await this.pocketBaseService.labelTrackMutator.create(track);
          trackIds.push(created.id);
        }
      } catch (error) {
        this.logger.error(`Failed to insert track: ${error}`);
      }
    }
    return trackIds;
  }

  /**
   * Batch insert LabelSpeaker records
   */
  private async batchInsertLabelSpeakers(
    utterances: LabelSpeakerData[]
  ): Promise<string[]> {
    const speakerIds: string[] = [];
    const batchSize = 100;

    for (let i = 0; i < utterances.length; i += batchSize) {
      const batch = utterances.slice(i, i + batchSize);
      for (const speakerData of batch) {
        try {
          const existing =
            await this.pocketBaseService.labelSpeakerMutator.getList(
              1,
              1,
              `speakerHash = "${speakerData.speakerHash}"`
            );
          if (existing.items.length > 0) {
            speakerIds.push(existing.items[0].id);
          } else {
            const created =
              await this.pocketBaseService.labelSpeakerMutator.create(
                speakerData
              );
            speakerIds.push(created.id);
          }
        } catch (error) {
          if (this.isUniqueConstraintErrorForSpeaker(error)) {
            const existing =
              await this.pocketBaseService.labelSpeakerMutator.getList(
                1,
                1,
                `speakerHash = "${speakerData.speakerHash}"`
              );
            if (existing.items.length > 0) {
              speakerIds.push(existing.items[0].id);
              continue;
            }
          }
          this.logger.error(`Failed to insert speaker utterance: ${error}`);
        }
      }
    }
    return speakerIds;
  }

  private isUniqueConstraintErrorForSpeaker(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('unique constraint') ||
      message.includes('validation_not_unique') ||
      message.includes('speakerHash')
    );
  }
}
