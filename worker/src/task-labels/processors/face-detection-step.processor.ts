import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { ProcessingProvider, LabelType } from '@project/shared';
import { LabelCacheService } from '../services/label-cache.service';
import { LabelEntityService } from '../services/label-entity.service';
import { FaceDetectionExecutor } from '../executors/face-detection.executor';
import { FaceDetectionNormalizer } from '../normalizers/face-detection.normalizer';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import type { StepJobData } from '../../queue/types/job.types';
import type { FaceDetectionStepInput } from '../types/step-inputs';
import type { FaceDetectionStepOutput } from '../types/step-outputs';
import type {
  FaceDetectionResponse,
  LabelFaceData,
  LabelTrackData,
} from '../types';

// Re-export types for parent processor
export type { FaceDetectionStepInput, FaceDetectionStepOutput };

@Injectable()
export class FaceDetectionStepProcessor extends BaseStepProcessor<
  FaceDetectionStepInput,
  FaceDetectionStepOutput
> {
  protected readonly logger = new Logger(FaceDetectionStepProcessor.name);
  private readonly processorVersion = 'face-detection:1.0.0';

  constructor(
    private readonly labelCacheService: LabelCacheService,
    private readonly labelEntityService: LabelEntityService,
    private readonly faceDetectionExecutor: FaceDetectionExecutor,
    private readonly faceDetectionNormalizer: FaceDetectionNormalizer,
    private readonly pocketBaseService: PocketBaseService
  ) {
    super();
  }

  /**
   * Process face detection with cache awareness
   */
  async process(
    input: FaceDetectionStepInput,
    _job: Job<StepJobData>
  ): Promise<FaceDetectionStepOutput> {
    const startTime = Date.now();

    this.logger.log(
      `Processing face detection for media ${input.mediaId}, version ${input.version}`
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

      let response: FaceDetectionResponse;
      let cacheHit = false;

      if (
        cached &&
        this.labelCacheService.isCacheValid(cached, this.processorVersion)
      ) {
        this.logger.log(
          `Using cached face detection for media ${input.mediaId}`
        );
        response = cached.response as FaceDetectionResponse;
        cacheHit = true;
      } else {
        // Step 2: Cache miss - call executor
        this.logger.log(
          `Cache miss for media ${input.mediaId}, calling Face Detection API`
        );

        response = await this.faceDetectionExecutor.execute(
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
          ['FACE_DETECTION']
        );

        this.logger.log(
          `Face detection completed for media ${input.mediaId}, stored to cache`
        );
      }

      // Step 3: Call normalizer to transform response
      const normalizedData = await this.faceDetectionNormalizer.normalize({
        response,
        mediaId: input.mediaId,
        workspaceRef: input.workspaceRef,
        taskRef: input.taskRef,
        version: input.version,
        processor: 'face-detection', // Processor type identifier
        processorVersion: this.processorVersion, // Processor version string
      });

      // Step 4: Batch insert LabelEntity records
      const entityIds = await this.batchInsertLabelEntities(
        normalizedData.labelEntities
      );
      this.logger.debug(
        `Inserted ${entityIds.length} label entities for media ${input.mediaId}`
      );

      // Step 5: Batch insert LabelTrack records (with keyframes and attributes)
      // Face detection creates a single "Face" entity, so all tracks reference it
      const entityId = entityIds.length > 0 ? entityIds[0] : undefined;
      const { trackIds, trackIdToDbIdMap } = await this.batchInsertLabelTracks(
        normalizedData.labelTracks,
        entityId
      );
      this.logger.debug(
        `Inserted ${trackIds.length} label tracks for media ${input.mediaId}`
      );

      // Step 6: Batch insert LabelFace records
      const faceIds = await this.batchInsertLabelFaces(
        normalizedData.labelFaces || [],
        entityId,
        trackIdToDbIdMap
      );
      this.logger.debug(
        `Inserted ${faceIds.length} label faces for media ${input.mediaId}`
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
          faceCount: normalizedData.labelMediaUpdate.faceCount || 0,
          faceTrackCount: normalizedData.labelMediaUpdate.faceTrackCount || 0,
          labelEntityCount: entityIds.length,
          labelTrackCount: trackIds.length,
          labelClipCount: 0,
          labelObjectCount: 0,
          labelFaceCount: normalizedData.labelMediaUpdate.faceCount || 0,
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
        `Face detection failed for media ${input.mediaId}: ${errorMessage}`
      );

      return {
        success: false,
        cacheHit: false,
        processorVersion: this.processorVersion,
        processingTimeMs: Date.now() - startTime,
        error: errorMessage,
        counts: {
          faceCount: 0,
          faceTrackCount: 0,
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
      // Face detection always uses GOOGLE_VIDEO_INTELLIGENCE
      const provider = entity.provider as
        | ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE
        | ProcessingProvider.GOOGLE_SPEECH;
      const entityId = await this.labelEntityService.getOrCreateLabelEntity(
        entity.WorkspaceRef,
        entity.labelType,
        entity.canonicalName,
        provider,
        entity.processor,
        entity.metadata
      );
      entityIds.push(entityId);
    }

    return entityIds;
  }

  /**
   * Batch insert LabelFace records
   *
   * @returns Object with faceIds array and trackIdToFaceIdMap
   */
  private async batchInsertLabelFaces(
    faces: LabelFaceData[],
    entityId?: string,
    trackIdToDbIdMap?: Map<string, string>
  ): Promise<string[]> {
    const faceIds: string[] = [];
    const batchSize = 100;

    for (let i = 0; i < faces.length; i += batchSize) {
      const batch = faces.slice(i, i + batchSize);
      let insertedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const face of batch) {
        try {
          // Check if a face with this faceHash already exists
          const existing =
            await this.pocketBaseService.labelFaceMutator.getList(
              1,
              1,
              `faceHash = "${face.faceHash}"`
            );

          if (existing.items.length > 0) {
            const dbId = existing.items[0].id;
            faceIds.push(dbId);
            skippedCount++;
          } else {
            const labelTrackRef = trackIdToDbIdMap?.get(face.trackId);
            const created =
              await this.pocketBaseService.labelFaceMutator.create({
                ...face,
                LabelEntityRef: entityId || face.LabelEntityRef || '',
                LabelTrackRef: labelTrackRef,
                metadata: face.metadata || {},
              });
            faceIds.push(created.id);
            insertedCount++;
          }
        } catch (error) {
          this.logger.error(
            `Failed to insert label face: ${error instanceof Error ? error.message : String(error)}`
          );
          errorCount++;
        }
      }

      this.logger.debug(
        `Face Batch ${Math.floor(i / batchSize) + 1}: Inserted ${insertedCount}, skipped ${skippedCount} duplicate faces, ${errorCount} errors`
      );
    }

    return faceIds;
  }

  /**
   * Batch insert LabelTrack records
   * Inserts in batches of 100 for performance
   * Handles duplicate trackHash by checking for existing records first
   * Sets LabelEntityRef on tracks if entityId is provided
   * Stores keyframes data in the keyframes column
   *
   * Note: Tracks are already validated and filtered by the normalizer
   *
   * @returns Object with trackIds array and trackIdToDbIdMap for linking clips to tracks
   */
  private async batchInsertLabelTracks(
    tracks: LabelTrackData[],
    entityId?: string
  ): Promise<{ trackIds: string[]; trackIdToDbIdMap: Map<string, string> }> {
    const trackIds: string[] = [];
    const trackIdToDbIdMap = new Map<string, string>(); // Map trackId -> database ID
    const batchSize = 100;

    for (let i = 0; i < tracks.length; i += batchSize) {
      const batch = tracks.slice(i, i + batchSize);
      let insertedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const track of batch) {
        try {
          // Check if a track with this trackHash already exists
          const existing =
            await this.pocketBaseService.labelTrackMutator.getList(
              1,
              1,
              `trackHash = "${track.trackHash}"`
            );

          if (existing.items.length > 0) {
            // Track already exists, use existing ID
            const dbId = existing.items[0].id;
            trackIds.push(dbId);
            trackIdToDbIdMap.set(track.trackId, dbId);
            skippedCount++;
            this.logger.debug(
              `Skipped duplicate label track with hash ${track.trackHash}`
            );
          } else {
            // Track doesn't exist, create it
            // Set LabelEntityRef if entityId is provided (required field)
            // keyframes are already included in the track data from normalizer
            const labelEntityRef = entityId || track.LabelEntityRef;
            if (!labelEntityRef) {
              this.logger.error(
                `Cannot create label track without LabelEntityRef for trackId ${track.trackId}`
              );
              errorCount++;
              continue;
            }

            const created =
              await this.pocketBaseService.labelTrackMutator.create({
                ...track,
                LabelEntityRef: labelEntityRef,
                keyframes: track.keyframes, // Ensure keyframes are stored
              });
            trackIds.push(created.id);
            trackIdToDbIdMap.set(track.trackId, created.id);
            insertedCount++;
          }
        } catch (error) {
          // Check if this is a unique constraint error (race condition)
          if (this.isUniqueConstraintErrorForTrack(error)) {
            // Try to fetch the existing record
            try {
              const existing =
                await this.pocketBaseService.labelTrackMutator.getList(
                  1,
                  1,
                  `trackHash = "${track.trackHash}"`
                );
              if (existing.items.length > 0) {
                const dbId = existing.items[0].id;
                trackIds.push(dbId);
                trackIdToDbIdMap.set(track.trackId, dbId);
                skippedCount++;
                this.logger.debug(
                  `Resolved duplicate label track with hash ${track.trackHash} (race condition)`
                );
              } else {
                // Shouldn't happen, but log it
                this.logger.warn(
                  `Unique constraint error for trackHash ${track.trackHash} but record not found`
                );
                errorCount++;
              }
            } catch (fetchError) {
              this.logger.error(
                `Failed to fetch existing label track after unique constraint error: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`
              );
              errorCount++;
            }
          } else {
            // Some other error occurred
            this.logger.error(
              `Failed to insert label track: ${error instanceof Error ? error.message : String(error)}`
            );
            errorCount++;
          }
        }
      }

      this.logger.debug(
        `Batch ${Math.floor(i / batchSize) + 1}: Inserted ${insertedCount}, skipped ${skippedCount} duplicate tracks, ${errorCount} errors`
      );
    }

    return { trackIds, trackIdToDbIdMap };
  }

  /**
   * Check if an error is a unique constraint violation for clips
   *
   * @param error The error to check
   * @returns True if the error is a unique constraint violation
   */
  private isUniqueConstraintError(error: unknown): boolean {
    if (!error) return false;

    // Check for PocketBase error structure
    if (typeof error === 'object' && 'data' in error) {
      const data = (error as { data?: { labelHash?: { code?: string } } }).data;
      if (data?.labelHash?.code === 'validation_not_unique') {
        return true;
      }
    }

    // Check error message
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('unique constraint') ||
      message.includes('UNIQUE constraint') ||
      message.includes('validation_not_unique') ||
      message.includes('labelHash')
    );
  }

  /**
   * Check if an error is a unique constraint violation for tracks
   *
   * @param error The error to check
   * @returns True if the error is a unique constraint violation
   */
  private isUniqueConstraintErrorForTrack(error: unknown): boolean {
    if (!error) return false;

    // Check for PocketBase error structure
    if (typeof error === 'object' && 'data' in error) {
      const data = (error as { data?: { trackHash?: { code?: string } } }).data;
      if (data?.trackHash?.code === 'validation_not_unique') {
        return true;
      }
    }

    // Check error message
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('unique constraint') ||
      message.includes('UNIQUE constraint') ||
      message.includes('validation_not_unique') ||
      message.includes('trackHash')
    );
  }
}
