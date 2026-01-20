import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { ProcessingProvider, LabelType } from '@project/shared';
import { LabelCacheService } from '../services/label-cache.service';
import { LabelEntityService } from '../services/label-entity.service';
import { SpeechTranscriptionExecutor } from '../executors/speech-transcription.executor';
import { SpeechTranscriptionNormalizer } from '../normalizers/speech-transcription.normalizer';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import type { StepJobData } from '../../queue/types/job.types';
import type { SpeechTranscriptionStepInput } from '../types/step-inputs';
import type { SpeechTranscriptionStepOutput } from '../types/step-outputs';
import type {
  LabelEntityData,
  LabelTrackData,
  LabelSpeechData,
} from '../types/normalizer-outputs';

// Re-export types for parent processor
export type { SpeechTranscriptionStepInput, SpeechTranscriptionStepOutput };

/**
 * Step processor for SPEECH_TRANSCRIPTION in detect_labels flow
 *
 * This processor:
 * 1. Checks cache before calling executor
 * 2. Calls SpeechTranscriptionExecutor (SPEECH_TRANSCRIPTION)
 * 3. Calls SpeechTranscriptionNormalizer to transform response
 * 4. Batch inserts LabelEntity records (for speakers)
 * 5. Batch inserts LabelTrack records (for speaker timelines)
 * 6. Batch inserts LabelSpeech records (for detailed timing)
 * 7. Updates LabelMedia with aggregated data (transcript, word counts)
 * 8. Stores normalized response to cache
 */
@Injectable()
export class SpeechTranscriptionStepProcessor extends BaseStepProcessor<
  SpeechTranscriptionStepInput,
  SpeechTranscriptionStepOutput
> {
  protected readonly logger = new Logger(SpeechTranscriptionStepProcessor.name);
  private readonly processorVersion = 'speech-transcription:1.0.1';

  constructor(
    private readonly labelCacheService: LabelCacheService,
    private readonly labelEntityService: LabelEntityService,
    private readonly speechTranscriptionExecutor: SpeechTranscriptionExecutor,
    private readonly speechTranscriptionNormalizer: SpeechTranscriptionNormalizer,
    private readonly pocketBaseService: PocketBaseService
  ) {
    super();
  }

  /**
   * Process speech transcription with cache awareness
   */
  async process(
    input: SpeechTranscriptionStepInput,
    job: Job<StepJobData>
  ): Promise<SpeechTranscriptionStepOutput> {
    const startTime = Date.now();

    this.logger.log(
      `Processing speech transcription for media ${input.mediaId}, version ${input.version}`
    );

    try {
      // Step 0: Check if media has audio
      const media = await this.pocketBaseService.getMedia(input.mediaId);
      if (media.hasAudio === false) {
        this.logger.log(
          `Media ${input.mediaId} has no audio track, skipping speech transcription`
        );
        return {
          success: true,
          cacheHit: false,
          processorVersion: this.processorVersion,
          processingTimeMs: Date.now() - startTime,
          counts: {
            transcriptLength: 0,
            wordCount: 0,
            labelEntityCount: 0,
            labelTrackCount: 0,
            labelClipCount: 0,
            labelObjectCount: 0,
            labelFaceCount: 0,
            labelPersonCount: 0,
            labelSpeechCount: 0,
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
        ProcessingProvider.GOOGLE_SPEECH,
        this.processorVersion
      );

      let response: any;
      let cacheHit = false;

      if (
        cached &&
        this.labelCacheService.isCacheValid(cached, this.processorVersion)
      ) {
        this.logger.log(
          `Using cached speech transcription for media ${input.mediaId}`
        );
        response = cached.response;
        cacheHit = true;
      } else {
        // Step 2: Cache miss - call executor
        this.logger.log(
          `Cache miss for media ${input.mediaId}, calling Speech Transcription API`
        );

        response = await this.speechTranscriptionExecutor.execute(
          input.workspaceRef,
          input.mediaId,
          input.config
        );

        // Step 7: Store normalized response to cache
        await this.labelCacheService.storeLabelCache(
          input.workspaceRef,
          input.mediaId,
          input.version,
          ProcessingProvider.GOOGLE_SPEECH,
          response,
          this.processorVersion,
          ['SPEECH_TRANSCRIPTION']
        );

        this.logger.log(
          `Speech transcription completed for media ${input.mediaId}, stored to cache`
        );
      }

      // Step 3: Call normalizer to transform response
      const normalizedData = await this.speechTranscriptionNormalizer.normalize(
        {
          response,
          mediaId: input.mediaId,
          workspaceRef: input.workspaceRef,
          taskRef: input.taskRef,
          version: input.version,
          processor: 'speech-transcription',
          processorVersion: this.processorVersion,
        }
      );

      // Step 4: Batch insert LabelEntity records
      // Map speaker tags to entity IDs
      const entityMap = new Map<number, string>();
      for (const entity of normalizedData.labelEntities) {
        const entityId = await this.labelEntityService.getOrCreateLabelEntity(
          entity.WorkspaceRef,
          entity.labelType,
          entity.canonicalName,
          entity.provider as ProcessingProvider.GOOGLE_SPEECH,
          entity.processor,
          entity.metadata
        );
        const speakerTag = (entity.metadata as any)?.speakerTag ?? 0;
        entityMap.set(speakerTag, entityId);
      }
      this.logger.debug(`Processed ${entityMap.size} speaker entities`);

      // Step 5: Batch insert LabelTrack records
      // Link tracks to entities
      const trackMap = new Map<number, string>();
      const tracksToInsert = (normalizedData.labelTracks || []).map((track) => {
        const speakerTag = (track.trackData as any)?.speakerTag ?? 0;
        return {
          ...track,
          LabelEntityRef: entityMap.get(speakerTag),
        };
      });

      const trackIds = await this.batchInsertLabelTracks(tracksToInsert);

      // Map speaker tags to track IDs (using tracksToInsert to maintain order)
      tracksToInsert.forEach((track, index) => {
        const speakerTag = (track.trackData as any)?.speakerTag ?? 0;
        trackMap.set(speakerTag, trackIds[index]);
      });
      this.logger.debug(`Inserted ${trackIds.length} speaker tracks`);

      // Step 6: Batch insert LabelSpeech records
      // Link speech to entities and tracks
      const speechToInsert = (normalizedData.labelSpeech || []).map(
        (speech) => {
          const speakerTag = speech.speakerTag ?? 0;
          return {
            ...speech,
            LabelEntityRef: entityMap.get(speakerTag),
            LabelTrackRef: trackMap.get(speakerTag),
          };
        }
      );

      const speechIds = await this.batchInsertLabelSpeech(speechToInsert);
      this.logger.debug(`Inserted ${speechIds.length} label speech segments`);

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
          labelEntityCount: entityMap.size,
          labelTrackCount: trackIds.length,
          labelClipCount: 0, // No longer creating clips
          labelObjectCount: 0,
          labelFaceCount: 0,
          labelPersonCount: 0,
          labelSpeechCount: speechIds.length,
          labelSegmentCount: 0,
          labelShotCount: 0,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Speech transcription failed for media ${input.mediaId}: ${errorMessage}`
      );

      return {
        success: false,
        cacheHit: false,
        processorVersion: this.processorVersion,
        processingTimeMs: Date.now() - startTime,
        error: errorMessage,
        counts: {
          transcriptLength: 0,
          wordCount: 0,
          labelEntityCount: 0,
          labelTrackCount: 0,
          labelClipCount: 0,
          labelObjectCount: 0,
          labelFaceCount: 0,
          labelPersonCount: 0,
          labelSpeechCount: 0,
          labelSegmentCount: 0,
          labelShotCount: 0,
        },
      };
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
   * Batch insert LabelSpeech records
   */
  private async batchInsertLabelSpeech(
    speechSegments: LabelSpeechData[]
  ): Promise<string[]> {
    const speechIds: string[] = [];
    const batchSize = 100;

    for (let i = 0; i < speechSegments.length; i += batchSize) {
      const batch = speechSegments.slice(i, i + batchSize);
      for (const speechData of batch) {
        try {
          const existing =
            await this.pocketBaseService.labelSpeechMutator.getList(
              1,
              1,
              `speechHash = "${speechData.speechHash}"`
            );
          if (existing.items.length > 0) {
            speechIds.push(existing.items[0].id);
          } else {
            const created =
              await this.pocketBaseService.labelSpeechMutator.create(
                speechData
              );
            speechIds.push(created.id);
          }
        } catch (error) {
          if (this.isUniqueConstraintErrorForSpeech(error)) {
            const existing =
              await this.pocketBaseService.labelSpeechMutator.getList(
                1,
                1,
                `speechHash = "${speechData.speechHash}"`
              );
            if (existing.items.length > 0) {
              speechIds.push(existing.items[0].id);
              continue;
            }
          }
          this.logger.error(`Failed to insert speech segment: ${error}`);
        }
      }
    }
    return speechIds;
  }

  private isUniqueConstraintErrorForSpeech(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('unique constraint') ||
      message.includes('validation_not_unique') ||
      message.includes('speechHash')
    );
  }
}
