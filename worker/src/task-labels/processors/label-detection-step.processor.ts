import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { LabelType, ProcessingProvider } from '@project/shared';
import { LabelCacheService } from '../services/label-cache.service';
import { LabelEntityService } from '../services/label-entity.service';
import { LabelDetectionExecutor } from '../executors/label-detection.executor';
import { LabelDetectionNormalizer } from '../normalizers/label-detection.normalizer';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
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

      // Step 4: Batch insert LabelEntity records
      const entityIdMap = await this.batchInsertLabelEntities(
        normalizedData.labelEntities
      );
      const entityIds = Object.values(entityIdMap);

      // Step 5: Batch insert specialized records (Segments and Shots)
      const segmentsWithRefs = (normalizedData.labelSegments || []).map(
        (segment) => ({
          ...segment,
          LabelEntityRef:
            segment.LabelEntityRef ||
            this.getEntityRefForLabel(
              segment.WorkspaceRef,
              segment.labelType,
              segment.entity,
              segment.metadata,
              entityIdMap
            ),
        })
      );
      const shotsWithRefs = (normalizedData.labelShots || []).map((shot) => ({
        ...shot,
        LabelEntityRef:
          shot.LabelEntityRef ||
          this.getEntityRefForLabel(
            shot.WorkspaceRef,
            shot.labelType,
            shot.entity,
            shot.metadata,
            entityIdMap
          ),
      }));

      const segmentIds = await this.batchInsertLabelSegments(segmentsWithRefs);
      const shotIds = await this.batchInsertLabelShots(shotsWithRefs);

      // Clear entity cache
      this.labelEntityService.clearCache();

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
          labelEntityCount: entityIds.length,
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

      return {
        success: false,
        cacheHit: false,
        processorVersion: this.processorVersion,
        processingTimeMs: Date.now() - startTime,
        error: errorMessage,
        counts: {
          segmentLabelCount: 0,
          shotLabelCount: 0,
          shotCount: 0,
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

  private async batchInsertLabelEntities(
    entities: Array<{
      WorkspaceRef: string;
      labelType: LabelType;
      canonicalName: string;
      provider: ProcessingProvider;
      processor: string;
      metadata?: Record<string, unknown>;
      entityHash?: string;
    }>
  ): Promise<Record<string, string>> {
    const entityIdMap: Record<string, string> = {};
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
      const entityHash =
        entity.entityHash ||
        this.labelEntityService.generateEntityHash(
          entity.WorkspaceRef,
          entity.labelType,
          entity.canonicalName,
          entity.provider
        );
      entityIdMap[entityHash] = entityId;
    }
    return entityIdMap;
  }

  private async batchInsertLabelSegments(
    segments: LabelSegmentData[]
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const data of segments) {
      try {
        const existing =
          await this.pocketBaseService.labelSegmentMutator.getFirstByFilter(
            `segmentHash = "${data.segmentHash}"`
          );
        if (existing) {
          ids.push(existing.id);
        } else {
          const created =
            await this.pocketBaseService.labelSegmentMutator.create(data);
          ids.push(created.id);
        }
      } catch (e) {
        this.logger.error(`Failed to insert segment: ${e}`);
      }
    }
    return ids;
  }

  private async batchInsertLabelShots(
    shots: LabelShotData[]
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const data of shots) {
      try {
        const existing =
          await this.pocketBaseService.labelShotMutator.getFirstByFilter(
            `shotHash = "${data.shotHash}"`
          );
        if (existing) {
          ids.push(existing.id);
        } else {
          const created =
            await this.pocketBaseService.labelShotMutator.create(data);
          ids.push(created.id);
        }
      } catch (e) {
        this.logger.error(`Failed to insert shot: ${e}`);
      }
    }
    return ids;
  }

  private getEntityRefForLabel(
    workspaceRef: string,
    labelType: LabelType,
    canonicalName: string,
    metadata: Record<string, unknown> | undefined,
    entityIdMap: Record<string, string>
  ): string | undefined {
    const entityHash = metadata?.entityHash as string | undefined;
    if (entityHash && entityIdMap[entityHash]) {
      return entityIdMap[entityHash];
    }

    const provider =
      (metadata?.provider as ProcessingProvider | undefined) ??
      ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE;
    const generatedHash = this.labelEntityService.generateEntityHash(
      workspaceRef,
      labelType,
      canonicalName,
      provider as ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE
    );
    return entityIdMap[generatedHash];
  }
}
