import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { ProcessingProvider } from '@project/shared';
import { LabelCacheService } from '../services/label-cache.service';
import { LabelEntityService } from '../services/label-entity.service';
import { ObjectTrackingExecutor } from '../executors/object-tracking.executor';
import { ObjectTrackingNormalizer } from '../normalizers/object-tracking.normalizer';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { relinkEntityRef } from '../utils/entity-ref';
import type { StepJobData } from '../../queue/types/job.types';
import type { ObjectTrackingStepInput } from '../types/step-inputs';
import type { ObjectTrackingStepOutput } from '../types/step-outputs';
import type {
  ObjectTrackingResponse,
  LabelTrackData,
  LabelObjectData,
} from '../types';

// Re-export types for parent processor
export type { ObjectTrackingStepInput, ObjectTrackingStepOutput };

/**
 * Step processor for OBJECT_TRACKING in detect_labels flow
 *
 * This processor:
 * 1. Checks cache before calling executor
 * 2. Calls ObjectTrackingExecutor (OBJECT_TRACKING)
 * 3. Calls ObjectTrackingNormalizer to transform response
 * 4. Batch inserts LabelEntity records
 * 5. Batch inserts LabelTrack records (with keyframes)
 * 7. Updates LabelMedia with aggregated data
 * 8. Stores normalized response to cache
 *
 * Implements cache-aware processing to avoid redundant API calls.
 */
@Injectable()
export class ObjectTrackingStepProcessor extends BaseStepProcessor<
  ObjectTrackingStepInput,
  ObjectTrackingStepOutput
> {
  protected readonly logger = new Logger(ObjectTrackingStepProcessor.name);
  private readonly processorVersion = 'object-tracking:1.0.0';

  constructor(
    private readonly labelCacheService: LabelCacheService,
    private readonly labelEntityService: LabelEntityService,
    private readonly objectTrackingExecutor: ObjectTrackingExecutor,
    private readonly objectTrackingNormalizer: ObjectTrackingNormalizer,
    private readonly pocketBaseService: PocketBaseService
  ) {
    super();
  }

  /**
   * Process object tracking with cache awareness
   */
  async process(
    input: ObjectTrackingStepInput,
    _job: Job<StepJobData>
  ): Promise<ObjectTrackingStepOutput> {
    const startTime = Date.now();

    this.logger.log(
      `Processing object tracking for media ${input.mediaId}, version ${input.version}`
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

      let response: ObjectTrackingResponse;
      let cacheHit = false;

      if (
        cached &&
        this.labelCacheService.isCacheValid(cached, this.processorVersion)
      ) {
        this.logger.log(
          `Using cached object tracking for media ${input.mediaId}`
        );
        response = cached.response as ObjectTrackingResponse;
        cacheHit = true;
      } else {
        // Step 2: Cache miss - call executor
        this.logger.log(
          `Cache miss for media ${input.mediaId}, calling Object Tracking API`
        );

        response = await this.objectTrackingExecutor.execute(
          input.workspaceRef,
          input.mediaId,
          input.config
        );

        // Step 8: Store normalized response to cache
        await this.labelCacheService.storeLabelCache(
          input.workspaceRef,
          input.mediaId,
          input.version,
          ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          response,
          this.processorVersion,
          ['OBJECT_TRACKING']
        );

        this.logger.log(
          `Object tracking completed for media ${input.mediaId}, stored to cache`
        );
      }

      // Step 3: Call normalizer to transform response
      const normalizedData = await this.objectTrackingNormalizer.normalize({
        response,
        mediaId: input.mediaId,
        workspaceRef: input.workspaceRef,
        taskRef: input.taskRef,
        version: input.version,
        processor: 'object-tracking',
        processorVersion: this.processorVersion,
      });

      // Step 4: Resolve one LabelEntity per detected instance
      const entityByInstance = await this.labelEntityService.resolveEntities(
        normalizedData.labelEntities
      );
      this.logger.debug(
        `Resolved ${entityByInstance.size} label entities for media ${input.mediaId}`
      );

      // Step 5: Batch insert LabelTrack records (with keyframes)
      const trackIdMap = await this.batchInsertLabelTracks(
        normalizedData.labelTracks,
        entityByInstance
      );
      this.logger.debug(
        `Inserted ${Object.keys(trackIdMap).length} label tracks for media ${input.mediaId}`
      );

      // Step 6: Batch insert LabelObject records
      const objectIds = await this.batchInsertLabelObjects(
        normalizedData.labelObjects || [],
        trackIdMap,
        entityByInstance
      );
      this.logger.debug(
        `Inserted ${objectIds.length} label objects for media ${input.mediaId}`
      );

      const processingTimeMs = Date.now() - startTime;

      return {
        success: true,
        cacheHit,
        processorVersion: this.processorVersion,
        processingTimeMs,
        counts: {
          objectCount: objectIds.length,
          objectTrackCount: Object.keys(trackIdMap).length,
          labelEntityCount: entityByInstance.size,
          labelTrackCount: Object.keys(trackIdMap).length,
          labelClipCount: 0,
          labelObjectCount: objectIds.length,
          labelFaceCount: 0,
          labelPersonCount: 0,
          labelSpeechCount: 0,
          labelSegmentCount: 0,
          labelShotCount: 0,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Object tracking failed for media ${input.mediaId}: ${errorMessage}`
      );

      // Rethrow so processStepJob produces a status: 'failed' StepResult.
      // Swallowing this into a success:false output makes the parent's
      // partial-success accounting count a failed step as completed.
      throw error;
    }
  }

  /**
   * Batch insert LabelTrack records
   * Returns a map of trackHash -> PocketBase ID
   *
   * @param entityByInstance instanceId -> LabelEntity id, from the normalizer's
   *   per-instance entities. Looked up rather than re-derived: the entity is
   *   the track's identity, and re-deriving it here from the track's own
   *   fields is how the two could silently disagree.
   *
   * A hash-matched track is repointed at the resolved entity rather than
   * reused as-is — see `relinkEntityRef`.
   */
  private async batchInsertLabelTracks(
    tracks: Array<LabelTrackData>,
    entityByInstance: Map<string, string>
  ): Promise<Record<string, string>> {
    const trackIdMap: Record<string, string> = {};
    const batchSize = 50;

    for (let i = 0; i < tracks.length; i += batchSize) {
      const batch = tracks.slice(i, i + batchSize);

      for (const track of batch) {
        try {
          const entityId = entityByInstance.get(track.trackId);
          if (!entityId) {
            this.logger.warn(
              `No LabelEntity for track ${track.trackId}, skipping`
            );
            continue;
          }

          // Check if track already exists
          const existing =
            await this.pocketBaseService.labelTrackMutator.getFirstByFilter(
              `trackHash = "${track.trackHash}"`
            );

          if (existing) {
            await relinkEntityRef(
              this.pocketBaseService.labelTrackMutator,
              existing,
              entityId
            );
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
   * Batch insert LabelObject records
   */
  private async batchInsertLabelObjects(
    objects: Array<LabelObjectData>,
    trackIdMap: Record<string, string>,
    entityByInstance: Map<string, string>
  ): Promise<string[]> {
    const objectIds: string[] = [];
    const batchSize = 50;

    for (let i = 0; i < objects.length; i += batchSize) {
      const batch = objects.slice(i, i + batchSize);

      for (const obj of batch) {
        try {
          // The leaf belongs to its track's instance, so it inherits that
          // track's entity — keyed on originalTrackId, which the normalizer
          // sets to the unique per-segment track id.
          const entityId = entityByInstance.get(obj.originalTrackId);
          if (!entityId) {
            this.logger.warn(
              `No LabelEntity for object ${obj.objectHash} (track ${obj.originalTrackId}), skipping`
            );
            continue;
          }

          const trackRef = trackIdMap[obj.originalTrackId];

          // Check if object already exists
          const existing =
            await this.pocketBaseService.labelObjectMutator.getFirstByFilter(
              `objectHash = "${obj.objectHash}"`
            );

          if (existing) {
            await relinkEntityRef(
              this.pocketBaseService.labelObjectMutator,
              existing,
              entityId
            );
            objectIds.push(existing.id);
            continue;
          }

          // A missing trackRef means the parent LabelTrack was never inserted
          // (its create failed upstream). LabelTrackRef is required, so calling
          // create() here would throw a misleading ZodError pointing at the
          // object schema instead of the real upstream failure. Skip cleanly.
          if (!trackRef) {
            this.logger.warn(
              `Skipping label object (objectHash=${obj.objectHash}): parent LabelTrack for originalTrackId "${obj.originalTrackId}" was not inserted`
            );
            continue;
          }

          const created =
            await this.pocketBaseService.labelObjectMutator.create({
              ...obj,
              LabelEntityRef: entityId,
              LabelTrackRef: trackRef,
            });
          objectIds.push(created.id);
        } catch (error) {
          if (this.isUniqueConstraintError(error)) {
            const existing =
              await this.pocketBaseService.labelObjectMutator.getFirstByFilter(
                `objectHash = "${obj.objectHash}"`
              );
            if (existing) {
              objectIds.push(existing.id);
              continue;
            }
          }
          this.logger.warn(
            `Failed to insert label object (objectHash=${obj.objectHash}): ${this.formatPbError(error)}`
          );
        }
      }
    }

    return objectIds;
  }

  /**
   * Build a log-friendly string from an error, including PocketBase's
   * field-level validation detail.
   *
   * A PocketBase ClientResponseError's `.message` is always the generic
   * envelope ("Failed to create record."); the actionable per-field reasons
   * live in `error.response.data`. Logging only `.message` hides the real
   * cause, so we append the response body when present.
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
   * Check if an error is a unique constraint violation.
   *
   * PocketBase surfaces the `validation_not_unique` code in
   * `error.response.data.<field>.code`, NOT in `error.message` (which is the
   * generic "Failed to create record."). We therefore search both the message
   * and the serialized response body so genuine PB unique violations — not
   * just raw SQLite ones — are recognized and recovered from.
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
      haystack.includes('objectHash')
    );
  }
}
