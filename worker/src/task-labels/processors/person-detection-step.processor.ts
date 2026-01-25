import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { ProcessingProvider, LabelType } from '@project/shared';
import { LabelCacheService } from '../services/label-cache.service';
import { LabelEntityService } from '../services/label-entity.service';
import { PersonDetectionExecutor } from '../executors/person-detection.executor';
import { PersonDetectionNormalizer } from '../normalizers/person-detection.normalizer';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import type { StepJobData } from '../../queue/types/job.types';
import type { PersonDetectionStepInput } from '../types/step-inputs';
import type { PersonDetectionStepOutput } from '../types/step-outputs';
import type { PersonDetectionResponse } from '../types/executor-responses';
import type {
  LabelPersonData,
  LabelTrackData,
} from '../types/normalizer-outputs';

// Re-export types for parent processor
export type { PersonDetectionStepInput, PersonDetectionStepOutput };

/**
 * Step processor for PERSON_DETECTION in detect_labels flow
 *
 * This processor:
 * 1. Checks cache before calling executor
 * 2. Calls PersonDetectionExecutor (PERSON_DETECTION)
 * 3. Calls PersonDetectionNormalizer to transform response
 * 4. Batch inserts LabelEntity records
 * 5. Batch inserts LabelTrack records (with keyframes, landmarks, and attributes)
 * 6. Batch inserts LabelPerson records (with track references)
 * 7. Updates LabelMedia with aggregated data
 * 8. Stores normalized response to cache
 *
 * Implements cache-aware processing to avoid redundant API calls.
 */
@Injectable()
export class PersonDetectionStepProcessor extends BaseStepProcessor<
  PersonDetectionStepInput,
  PersonDetectionStepOutput
> {
  protected readonly logger = new Logger(PersonDetectionStepProcessor.name);
  private readonly processorVersion = 'person-detection:1.0.0';

  constructor(
    private readonly labelCacheService: LabelCacheService,
    private readonly labelEntityService: LabelEntityService,
    private readonly personDetectionExecutor: PersonDetectionExecutor,
    private readonly personDetectionNormalizer: PersonDetectionNormalizer,
    private readonly pocketBaseService: PocketBaseService
  ) {
    super();
  }

  /**
   * Process person detection with cache awareness
   */
  async process(
    input: PersonDetectionStepInput,
    _job: Job<StepJobData>
  ): Promise<PersonDetectionStepOutput> {
    const startTime = Date.now();

    this.logger.log(
      `Processing person detection for media ${input.mediaId}, version ${input.version}`
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

      let response: PersonDetectionResponse;
      let cacheHit = false;

      if (
        cached &&
        this.labelCacheService.isCacheValid(cached, this.processorVersion)
      ) {
        this.logger.log(
          `Using cached person detection for media ${input.mediaId}`
        );
        response = cached.response as PersonDetectionResponse;
        cacheHit = true;
      } else {
        // Step 2: Cache miss - call executor
        this.logger.log(
          `Cache miss for media ${input.mediaId}, calling Person Detection API`
        );

        response = await this.personDetectionExecutor.execute(
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
          ['PERSON_DETECTION']
        );

        this.logger.log(
          `Person detection completed for media ${input.mediaId}, stored to cache`
        );
      }

      // Step 3: Call normalizer to transform response
      const normalizedData = await this.personDetectionNormalizer.normalize({
        response,
        mediaId: input.mediaId,
        workspaceRef: input.workspaceRef,
        taskRef: input.taskRef,
        version: input.version,
        processor: 'person-detection', // Processor type identifier
        processorVersion: this.processorVersion, // Processor version string
      });

      // Step 4: Batch insert LabelEntity records
      const entityIds = await this.batchInsertLabelEntities(
        normalizedData.labelEntities
      );
      const personEntityId = entityIds[0]; // Person detection usually has one "Person" entity
      this.logger.debug(
        `Inserted ${entityIds.length} label entities for media ${input.mediaId}`
      );

      // Step 5: Batch insert LabelTrack records (with keyframes, landmarks, and attributes)
      const trackIdsMap = await this.batchInsertLabelTracks(
        normalizedData.labelTracks,
        personEntityId
      );
      this.logger.debug(
        `Inserted ${Object.keys(trackIdsMap).length} label tracks for media ${input.mediaId}`
      );

      // Step 6: Batch insert LabelPerson records (linking to tracks and entity)
      const personIds = await this.batchInsertLabelPeople(
        normalizedData.labelPeople || [],
        personEntityId,
        trackIdsMap
      );
      this.logger.debug(
        `Inserted ${personIds.length} label people for media ${input.mediaId}`
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
          personCount: normalizedData.labelMediaUpdate.personCount || 0,
          personTrackCount:
            normalizedData.labelMediaUpdate.personTrackCount || 0,
          labelEntityCount: entityIds.length,
          labelTrackCount: Object.keys(trackIdsMap).length,
          labelClipCount: 0,
          labelObjectCount: 0,
          labelFaceCount: 0,
          labelPersonCount: personIds.length,
          labelSpeechCount: 0,
          labelSegmentCount: 0,
          labelShotCount: 0,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Person detection failed for media ${input.mediaId}: ${errorMessage}`
      );

      return {
        success: false,
        cacheHit: false,
        processorVersion: this.processorVersion,
        processingTimeMs: Date.now() - startTime,
        error: errorMessage,
        counts: {
          personCount: 0,
          personTrackCount: 0,
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
   * Returns a map of trackId -> database id
   */
  private async batchInsertLabelTracks(
    tracks: LabelTrackData[],
    entityId: string
  ): Promise<Record<string, string>> {
    const trackIdsMap: Record<string, string> = {};
    const batchSize = 50;

    for (let i = 0; i < tracks.length; i += batchSize) {
      const batch = tracks.slice(i, i + batchSize);

      for (const track of batch) {
        try {
          // Check if track exists by trackHash
          const existing =
            await this.pocketBaseService.labelTrackMutator.getFirstByFilter(
              `trackHash = "${track.trackHash}"`
            );

          if (existing) {
            trackIdsMap[track.trackId] = existing.id;
            continue;
          }

          const created = await this.pocketBaseService.labelTrackMutator.create(
            {
              ...track,
              LabelEntityRef: entityId,
            }
          );
          trackIdsMap[track.trackId] = created.id;
        } catch (error) {
          this.logger.warn(`Failed to insert label track: ${error}`);
        }
      }
    }

    return trackIdsMap;
  }

  /**
   * Batch insert LabelPerson records
   */
  private async batchInsertLabelPeople(
    people: LabelPersonData[],
    entityId: string,
    trackIdsMap: Record<string, string>
  ): Promise<string[]> {
    const personIds: string[] = [];
    const batchSize = 50;

    for (let i = 0; i < people.length; i += batchSize) {
      const batch = people.slice(i, i + batchSize);

      for (const person of batch) {
        try {
          // Link to the correct track
          const trackRef = trackIdsMap[person.personId];

          // Check if person record exists by personHash
          const existing =
            await this.pocketBaseService.labelPersonMutator.getFirstByFilter(
              `personHash = "${person.personHash}"`
            );

          if (existing) {
            personIds.push(existing.id);
            continue;
          }

          const created =
            await this.pocketBaseService.labelPersonMutator.create({
              ...person,
              LabelEntityRef: entityId,
              LabelTrackRef: trackRef,
            });
          personIds.push(created.id);
        } catch (error) {
          this.logger.warn(`Failed to insert label person: ${error}`);
        }
      }
    }

    return personIds;
  }
}
