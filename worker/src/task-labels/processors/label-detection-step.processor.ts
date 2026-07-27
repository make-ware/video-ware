import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { ProcessingProvider } from '@project/shared';
import { LabelCacheService } from '../services/label-cache.service';
import { LabelEntityService } from '../services/label-entity.service';
import { LabelDetectionExecutor } from '../executors/label-detection.executor';
import { LabelDetectionNormalizer } from '../normalizers/label-detection.normalizer';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { relinkEntityRef } from '../utils/entity-ref';
import { classificationInstanceId } from '../utils/instance-id';
import type { StepJobData } from '../../queue/types/job.types';
import type { LabelDetectionStepInput } from '../types/step-inputs';
import type { LabelDetectionStepOutput } from '../types/step-outputs';
import type {
  LabelDetectionResponse,
  LabelSegmentData,
  LabelShotData,
} from '../types';

// Re-export types for parent processor
export type { LabelDetectionStepInput, LabelDetectionStepOutput };

/**
 * Step processor for LABEL_DETECTION in detect_labels flow
 */
@Injectable()
export class LabelDetectionStepProcessor extends BaseStepProcessor<
  LabelDetectionStepInput,
  LabelDetectionStepOutput
> {
  protected readonly logger = new Logger(LabelDetectionStepProcessor.name);
  private readonly processorVersion = 'label-detection:1.1.0';

  constructor(
    private readonly labelCacheService: LabelCacheService,
    private readonly labelEntityService: LabelEntityService,
    private readonly labelDetectionExecutor: LabelDetectionExecutor,
    private readonly labelDetectionNormalizer: LabelDetectionNormalizer,
    private readonly pocketBaseService: PocketBaseService
  ) {
    super();
  }

  /**
   * Process label detection with cache awareness
   */
  async process(
    input: LabelDetectionStepInput,
    _job: Job<StepJobData>
  ): Promise<LabelDetectionStepOutput> {
    const startTime = Date.now();

    this.logger.log(
      `Processing label detection for media ${input.mediaId}, version ${input.version}`
    );

    try {
      // Step 1: Check cache
      const cached = await this.labelCacheService.getCachedLabels(
        input.workspaceRef,
        input.mediaId,
        input.version,
        ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        this.processorVersion
      );

      let response: LabelDetectionResponse;
      let cacheHit = false;

      if (
        cached &&
        this.labelCacheService.isCacheValid(cached, this.processorVersion)
      ) {
        this.logger.log(
          `Using cached label detection for media ${input.mediaId}`
        );
        response = cached.response as LabelDetectionResponse;
        cacheHit = true;
      } else {
        // Step 2: Cache miss - call executor
        this.logger.log(
          `Cache miss for media ${input.mediaId}, calling Label Detection API`
        );

        response = await this.labelDetectionExecutor.execute(
          input.workspaceRef,
          input.mediaId,
          input.config
        );

        // Log usage events (LABEL_DETECTION and SHOT_CHANGE_DETECTION)
        try {
          const media = await this.pocketBaseService.getMedia(input.mediaId);
          const duration = media.duration || 0;
          if (duration > 0) {
            await this.pocketBaseService.logUsageEvent({
              WorkspaceRef: input.workspaceRef,
              type: 'GOOGLE_VIDEO',
              subtype: 'LABEL_DETECTION',
              value: duration,
              unit: 'SECONDS',
              metadata: { mediaId: input.mediaId, version: input.version },
            });
            await this.pocketBaseService.logUsageEvent({
              WorkspaceRef: input.workspaceRef,
              type: 'GOOGLE_VIDEO',
              subtype: 'SHOT_CHANGE_DETECTION',
              value: duration,
              unit: 'SECONDS',
              metadata: { mediaId: input.mediaId, version: input.version },
            });
          }
        } catch (error) {
          this.logger.warn(
            `Failed to log usage events: ${error instanceof Error ? error.message : String(error)}`
          );
        }

        // Step 7: Store to cache
        await this.labelCacheService.storeLabelCache(
          input.workspaceRef,
          input.mediaId,
          input.version,
          ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          response,
          this.processorVersion,
          ['LABEL_DETECTION', 'SHOT_CHANGE_DETECTION']
        );
      }

      // Step 3: Normalize
      const normalizedData = await this.labelDetectionNormalizer.normalize({
        response,
        mediaId: input.mediaId,
        workspaceRef: input.workspaceRef,
        taskRef: input.taskRef,
        version: input.version,
        processor: 'label-detection',
        processorVersion: this.processorVersion,
      });

      // Step 4: Resolve one LabelEntity per segment/shot row. Shots and
      // segments have no provider track, so the row IS the instance and its
      // own hash is the instance key — which also means the leaf can find its
      // entity by that hash directly, with no metadata round-trip.
      const entityByInstance = await this.labelEntityService.resolveEntities(
        normalizedData.labelEntities
      );

      // Step 5: Batch insert specialized records (Segments and Shots)
      const segmentIds = await this.batchInsertLabelSegments(
        normalizedData.labelSegments || [],
        entityByInstance
      );
      const shotIds = await this.batchInsertLabelShots(
        normalizedData.labelShots || [],
        entityByInstance
      );

      const processingTimeMs = Date.now() - startTime;

      return {
        success: true,
        cacheHit,
        processorVersion: this.processorVersion,
        processingTimeMs,
        counts: {
          segmentLabelCount:
            normalizedData.labelMediaUpdate.segmentLabelCount || 0,
          shotLabelCount: normalizedData.labelMediaUpdate.shotLabelCount || 0,
          shotCount: normalizedData.labelMediaUpdate.shotCount || 0,
          labelEntityCount: entityByInstance.size,
          labelTrackCount: 0,
          labelClipCount: 0,
          labelObjectCount: 0,
          labelFaceCount: 0,
          labelPersonCount: 0,
          labelSpeechCount: 0,
          labelSegmentCount: segmentIds.length,
          labelShotCount: shotIds.length,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Label detection failed for media ${input.mediaId}: ${errorMessage}`
      );

      // Rethrow so processStepJob produces a status: 'failed' StepResult.
      // Swallowing this into a success:false output makes the parent's
      // partial-success accounting count a failed step as completed.
      throw error;
    }
  }

  /**
   * Upsert LabelSegment rows, keyed by segmentHash.
   *
   * The ROW is keyed by its hash; its ENTITY is keyed by the label class
   * within the media, so every "mountain" stretch resolves to the same
   * LabelEntity and one tag covers them all (see `classificationInstanceId`).
   * A miss means the entity upsert failed upstream:
   * the row is skipped rather than written with an empty LabelEntityRef, which
   * would be an unlinkable segment indistinguishable from a deliberately
   * unlinked one, and would never be repaired because the hash still matches
   * on the next run.
   *
   * A hash-matched row is repointed, not blindly reused — see
   * `relinkEntityRef`.
   */
  private async batchInsertLabelSegments(
    segments: LabelSegmentData[],
    entityByInstance: Map<string, string>
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const data of segments) {
      const entityId =
        entityByInstance.get(classificationInstanceId(data.entity)) ||
        data.LabelEntityRef;
      if (!entityId) {
        this.logger.warn(
          `No LabelEntity for segment ${data.segmentHash} ("${data.entity}"), skipping`
        );
        continue;
      }

      try {
        const existing =
          await this.pocketBaseService.labelSegmentMutator.getFirstByFilter(
            `segmentHash = "${data.segmentHash}"`
          );
        if (existing) {
          await relinkEntityRef(
            this.pocketBaseService.labelSegmentMutator,
            existing,
            entityId
          );
          ids.push(existing.id);
        } else {
          const created =
            await this.pocketBaseService.labelSegmentMutator.create({
              ...data,
              LabelEntityRef: entityId,
            });
          ids.push(created.id);
        }
      } catch (e) {
        this.logger.error(
          `Failed to insert segment (segmentHash=${data.segmentHash}): ${e}`
        );
      }
    }
    return ids;
  }

  /**
   * Upsert LabelShot rows, keyed by shotHash. Same contract as
   * `batchInsertLabelSegments`: the row is keyed by its hash and its entity by
   * the label class within the media, a missing entity is a warn-and-skip, and
   * an existing row is repointed.
   */
  private async batchInsertLabelShots(
    shots: LabelShotData[],
    entityByInstance: Map<string, string>
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const data of shots) {
      const entityId =
        entityByInstance.get(classificationInstanceId(data.entity)) ||
        data.LabelEntityRef;
      if (!entityId) {
        this.logger.warn(
          `No LabelEntity for shot ${data.shotHash} ("${data.entity}"), skipping`
        );
        continue;
      }

      try {
        const existing =
          await this.pocketBaseService.labelShotMutator.getFirstByFilter(
            `shotHash = "${data.shotHash}"`
          );
        if (existing) {
          await relinkEntityRef(
            this.pocketBaseService.labelShotMutator,
            existing,
            entityId
          );
          ids.push(existing.id);
        } else {
          const created = await this.pocketBaseService.labelShotMutator.create({
            ...data,
            LabelEntityRef: entityId,
          });
          ids.push(created.id);
        }
      } catch (e) {
        this.logger.error(
          `Failed to insert shot (shotHash=${data.shotHash}): ${e}`
        );
      }
    }
    return ids;
  }
}
