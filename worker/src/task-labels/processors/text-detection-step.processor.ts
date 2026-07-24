import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { LabelType, ProcessingProvider } from '@project/shared';
import { LabelCacheService } from '../services/label-cache.service';
import { LabelEntityService } from '../services/label-entity.service';
import { TextDetectionExecutor } from '../executors/text-detection.executor';
import { TextDetectionNormalizer } from '../normalizers/text-detection.normalizer';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import type { StepJobData } from '../../queue/types/job.types';
import type { TextDetectionStepInput } from '../types/step-inputs';
import type { TextDetectionStepOutput } from '../types/step-outputs';
import type {
  TextDetectionResponse,
  LabelTrackData,
  LabelTextData,
} from '../types';

// Re-export types for parent processor
export type { TextDetectionStepInput, TextDetectionStepOutput };

/**
 * Step processor for TEXT_DETECTION in detect_labels flow
 *
 * This processor:
 * 1. Checks cache before calling executor
 * 2. Calls TextDetectionExecutor (TEXT_DETECTION — on-screen text OCR)
 * 3. Calls TextDetectionNormalizer to transform response
 * 4. Batch inserts LabelEntity records (one per unique text string)
 * 5. Batch inserts LabelTrack records (with per-frame box keyframes)
 * 6. Batch inserts LabelText records (one per text appearance)
 * 7. Stores normalized response to cache
 *
 * Implements cache-aware processing to avoid redundant API calls.
 */
@Injectable()
export class TextDetectionStepProcessor extends BaseStepProcessor<
  TextDetectionStepInput,
  TextDetectionStepOutput
> {
  protected readonly logger = new Logger(TextDetectionStepProcessor.name);
  // Also the cache key: the cache stores the RAW provider response, and all
  // cleaning/filtering happens in the normalizer, so normalizer-side changes
  // must NOT bump this — a bump orphans every cached response and re-spends
  // API quota.
  private readonly processorVersion = 'text-detection:1.0.0';

  constructor(
    private readonly labelCacheService: LabelCacheService,
    private readonly labelEntityService: LabelEntityService,
    private readonly textDetectionExecutor: TextDetectionExecutor,
    private readonly textDetectionNormalizer: TextDetectionNormalizer,
    private readonly pocketBaseService: PocketBaseService
  ) {
    super();
  }

  /**
   * Process text detection with cache awareness
   */
  async process(
    input: TextDetectionStepInput,
    _job: Job<StepJobData>
  ): Promise<TextDetectionStepOutput> {
    const startTime = Date.now();

    this.logger.log(
      `Processing text detection for media ${input.mediaId}, version ${input.version}`
    );

    try {
      // Step 1: Check cache before calling executor
      const cached = await this.labelCacheService.getCachedLabels(
        input.workspaceRef,
        input.mediaId,
        input.version,
        ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        this.processorVersion
      );

      let response: TextDetectionResponse;
      let cacheHit = false;

      if (
        cached &&
        this.labelCacheService.isCacheValid(cached, this.processorVersion)
      ) {
        this.logger.log(
          `Using cached text detection for media ${input.mediaId}`
        );
        response = cached.response as TextDetectionResponse;
        cacheHit = true;
      } else {
        // Step 2: Cache miss - call executor
        this.logger.log(
          `Cache miss for media ${input.mediaId}, calling Text Detection API`
        );

        response = await this.textDetectionExecutor.execute(
          input.workspaceRef,
          input.mediaId,
          input.config
        );

        // Step 7: Store normalized response to cache
        await this.labelCacheService.storeLabelCache(
          input.workspaceRef,
          input.mediaId,
          input.version,
          ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          response,
          this.processorVersion,
          ['TEXT_DETECTION']
        );

        this.logger.log(
          `Text detection completed for media ${input.mediaId}, stored to cache`
        );
      }

      // Step 3: Call normalizer to transform response (cleaning thresholds
      // come from the step config; unset values fall back to defaults)
      const normalizedData = await this.textDetectionNormalizer.normalize(
        {
          response,
          mediaId: input.mediaId,
          workspaceRef: input.workspaceRef,
          taskRef: input.taskRef,
          version: input.version,
          processor: 'text-detection',
          processorVersion: this.processorVersion,
        },
        {
          minConfidence: input.config?.confidenceThreshold,
          minDurationSec: input.config?.minDurationSec,
          mergeGapSec: input.config?.mergeGapSec,
        }
      );

      // Step 4: Batch insert LabelEntity records
      const entityIds = await this.batchInsertLabelEntities(
        normalizedData.labelEntities
      );
      this.logger.debug(
        `Inserted ${entityIds.length} label entities for media ${input.mediaId}`
      );

      // Step 5: Batch insert LabelTrack records (with keyframes)
      const trackIdMap = await this.batchInsertLabelTracks(
        normalizedData.labelTracks
      );
      this.logger.debug(
        `Inserted ${Object.keys(trackIdMap).length} label tracks for media ${input.mediaId}`
      );

      // Step 6: Batch insert LabelText records
      const textIds = await this.batchInsertLabelTexts(
        normalizedData.labelTexts || [],
        trackIdMap
      );
      this.logger.debug(
        `Inserted ${textIds.length} label texts for media ${input.mediaId}`
      );

      // Clear entity cache after processing
      this.labelEntityService.clearCache();

      const processingTimeMs = Date.now() - startTime;

      return {
        success: true,
        cacheHit,
        processorVersion: this.processorVersion,
        processingTimeMs,
        counts: {
          textCount: textIds.length,
          textTrackCount: Object.keys(trackIdMap).length,
          labelEntityCount: entityIds.length,
          labelTrackCount: Object.keys(trackIdMap).length,
          labelClipCount: 0,
          labelObjectCount: 0,
          labelFaceCount: 0,
          labelPersonCount: 0,
          labelSpeechCount: 0,
          labelSegmentCount: 0,
          labelShotCount: 0,
          labelTextCount: textIds.length,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Text detection failed for media ${input.mediaId}: ${errorMessage}`
      );

      // Rethrow so processStepJob produces a status: 'failed' StepResult.
      // Swallowing this into a success:false output makes the parent's
      // partial-success accounting count a failed step as completed.
      throw error;
    }
  }

  /**
   * Batch insert LabelEntity records
   * Uses LabelEntityService for deduplication
   */
  private async batchInsertLabelEntities(
    entities: Array<{
      WorkspaceRef: string;
      labelType: LabelType;
      canonicalName: string;
      provider: ProcessingProvider;
      processor: string;
      metadata?: Record<string, unknown>;
    }>
  ): Promise<string[]> {
    const entityIds: string[] = [];

    for (const entity of entities) {
      const entityId = await this.labelEntityService.getOrCreateLabelEntity(
        entity.WorkspaceRef,
        entity.labelType,
        entity.canonicalName,
        entity.provider as
          | ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE
          | ProcessingProvider.GOOGLE_SPEECH,
        entity.processor,
        entity.metadata
      );
      entityIds.push(entityId);
    }

    return entityIds;
  }

  /**
   * Batch insert LabelTrack records
   * Returns a map of trackId -> PocketBase ID
   */
  private async batchInsertLabelTracks(
    tracks: Array<LabelTrackData>
  ): Promise<Record<string, string>> {
    const trackIdMap: Record<string, string> = {};
    const batchSize = 50;

    for (let i = 0; i < tracks.length; i += batchSize) {
      const batch = tracks.slice(i, i + batchSize);

      for (const track of batch) {
        try {
          // Get or create LabelEntity for this track's text string
          const entityId = await this.labelEntityService.getOrCreateLabelEntity(
            track.WorkspaceRef,
            LabelType.TEXT,
            (track.trackData.entity as string) || 'unknown',
            ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
            track.processor,
            {}
          );

          // Check if track already exists
          const existing =
            await this.pocketBaseService.labelTrackMutator.getFirstByFilter(
              `trackHash = "${track.trackHash}"`
            );

          if (existing) {
            trackIdMap[track.trackId] = existing.id;
            continue;
          }

          const created = await this.pocketBaseService.labelTrackMutator.create(
            {
              ...track,
              LabelEntityRef: entityId,
            }
          );
          trackIdMap[track.trackId] = created.id;
        } catch (error) {
          if (this.isUniqueConstraintError(error)) {
            const existing =
              await this.pocketBaseService.labelTrackMutator.getFirstByFilter(
                `trackHash = "${track.trackHash}"`
              );
            if (existing) {
              trackIdMap[track.trackId] = existing.id;
              continue;
            }
          }
          this.logger.warn(
            `Failed to insert label track (trackHash=${track.trackHash}): ${this.formatPbError(error)}`
          );
        }
      }
    }

    return trackIdMap;
  }

  /**
   * Batch insert LabelText records
   */
  private async batchInsertLabelTexts(
    texts: Array<LabelTextData>,
    trackIdMap: Record<string, string>
  ): Promise<string[]> {
    const textIds: string[] = [];
    const batchSize = 50;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      for (const entry of batch) {
        try {
          // Get or create LabelEntity for this text string
          const entityId = await this.labelEntityService.getOrCreateLabelEntity(
            entry.WorkspaceRef,
            LabelType.TEXT,
            entry.text,
            ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
            this.processorVersion,
            {}
          );

          const trackRef = trackIdMap[entry.originalTrackId];

          // Check if this text row already exists
          const existing =
            await this.pocketBaseService.labelTextMutator.getFirstByFilter(
              `textHash = "${entry.textHash}"`
            );

          if (existing) {
            textIds.push(existing.id);
            continue;
          }

          const { originalTrackId: _originalTrackId, ...record } = entry;
          const created = await this.pocketBaseService.labelTextMutator.create({
            ...record,
            metadata: record.metadata ?? {},
            LabelEntityRef: entityId,
            LabelTrackRef: trackRef,
          });
          textIds.push(created.id);
        } catch (error) {
          if (this.isUniqueConstraintError(error)) {
            const existing =
              await this.pocketBaseService.labelTextMutator.getFirstByFilter(
                `textHash = "${entry.textHash}"`
              );
            if (existing) {
              textIds.push(existing.id);
              continue;
            }
          }
          this.logger.warn(
            `Failed to insert label text (textHash=${entry.textHash}): ${this.formatPbError(error)}`
          );
        }
      }
    }

    return textIds;
  }

  /**
   * Build a log-friendly string from an error, including PocketBase's
   * field-level validation detail (`.message` alone is the generic envelope).
   */
  private formatPbError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const data = (error as { response?: { data?: unknown } })?.response?.data;
    if (data && typeof data === 'object' && Object.keys(data).length > 0) {
      return `${message} — ${JSON.stringify(data)}`;
    }
    return message;
  }

  /**
   * Check if an error is a unique constraint violation. PocketBase surfaces
   * `validation_not_unique` in `error.response.data.<field>.code`, not in
   * `error.message`, so search both.
   */
  private isUniqueConstraintError(error: unknown): boolean {
    if (!error) return false;

    const message = error instanceof Error ? error.message : String(error);
    const data = (error as { response?: { data?: unknown } })?.response?.data;
    const haystack = `${message} ${data ? JSON.stringify(data) : ''}`;

    return (
      haystack.includes('unique constraint') ||
      haystack.includes('UNIQUE constraint') ||
      haystack.includes('validation_not_unique') ||
      haystack.includes('trackHash') ||
      haystack.includes('textHash')
    );
  }
}
