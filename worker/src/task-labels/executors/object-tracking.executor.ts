/**
 * Object Tracking Executor
 *
 * Executes GCVI API calls for OBJECT_TRACKING feature.
 * This is a pure strategy implementation with no database operations.
 */

import { Injectable, Logger } from '@nestjs/common';
import { GoogleCloudService } from '../../shared/services/google-cloud.service';
import type {
  ObjectTrackingResponse,
  ObjectFrame,
} from '../types/executor-responses';
import { protos } from '@google-cloud/video-intelligence';

/**
 * Configuration for object tracking
 */
export interface ObjectTrackingConfig {
  model?: string; // default: 'builtin/latest'
  confidenceThreshold?: number; // default: 0.5
}

/**
 * Executor for Object Tracking API calls
 */
@Injectable()
export class ObjectTrackingExecutor {
  private readonly logger = new Logger(ObjectTrackingExecutor.name);

  constructor(private readonly googleCloudService: GoogleCloudService) {}

  /**
   * Execute object tracking on a video
   *
   * @param gcsUri - GCS URI of the video file (gs://bucket/path)
   * @param config - Object tracking configuration
   * @returns Normalized object tracking response
   */
  async execute(
    workspaceId: string,
    mediaId: string,
    config: ObjectTrackingConfig = {}
  ): Promise<ObjectTrackingResponse> {
    this.logger.log(`Executing object tracking for media ${mediaId}`);
    const gcsUri = this.googleCloudService.getTempGcsUri(workspaceId, mediaId);

    try {
      // Use the authenticated client from GoogleCloudService
      const client = this.googleCloudService.getVideoIntelligenceClient();

      // Build request
      const request = {
        inputUri: gcsUri,
        features: [
          protos.google.cloud.videointelligence.v1.Feature.OBJECT_TRACKING,
        ],
        videoContext: {
          objectTrackingConfig: {
            model: config.model || 'builtin/latest',
          },
        },
      };

      this.logger.debug(
        `Object tracking request: ${JSON.stringify({
          gcsUri,
          model: config.model || 'builtin/latest',
        })}`
      );

      // Execute API call
      const [operation] = await client.annotateVideo(request);
      this.logger.log(`Object tracking operation started: ${operation.name}`);

      // Wait for operation to complete
      const [result] = await operation.promise();

      // Validate that we got a valid result
      if (!result) {
        const errorMsg =
          'Object tracking operation completed but returned no result';
        this.logger.error(errorMsg);
        throw new Error(errorMsg);
      }

      // Validate annotation results exist
      if (!result.annotationResults || result.annotationResults.length === 0) {
        this.logger.warn('No annotation results returned from object tracking');
        return {
          objects: [],
        };
      }

      const annotation = result.annotationResults[0];

      // Process object annotations
      const objects = (annotation.objectAnnotations || []).map((obj, index) => {
        const rawTrackId = (obj as any).trackId;
        const trackId =
          rawTrackId !== undefined &&
          rawTrackId !== null &&
          String(rawTrackId) !== ''
            ? String(rawTrackId)
            : String(index);
        const entity = obj.entity?.description || '';
        const confidence = obj.confidence || 0;

        // Process frames with bounding boxes
        const frames: ObjectFrame[] = (obj.frames || []).map((frame) => ({
          timeOffset: this.parseTimeOffset(frame.timeOffset),
          boundingBox: {
            left: frame.normalizedBoundingBox?.left || 0,
            top: frame.normalizedBoundingBox?.top || 0,
            right: frame.normalizedBoundingBox?.right || 0,
            bottom: frame.normalizedBoundingBox?.bottom || 0,
          },
          confidence: confidence, // Use object-level confidence for frames
        }));

        return {
          entity,
          trackId,
          confidence,
          frames,
        };
      });

      // Apply confidence threshold if specified
      const threshold = config.confidenceThreshold ?? 0.5;
      const filteredObjects = objects.filter(
        (obj) => obj.confidence >= threshold
      );

      this.logger.log(
        `Object tracking completed: ${filteredObjects.length} objects tracked ` +
          `(${objects.length - filteredObjects.length} filtered by confidence threshold)`
      );

      return {
        objects: filteredObjects,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Object tracking failed: ${errorMessage}`);
      throw new Error(`Object tracking execution failed: ${errorMessage}`);
    }
  }

  /**
   * Parse Google Cloud time offset to seconds
   */
  private parseTimeOffset(timeOffset: any): number {
    if (!timeOffset) return 0;

    const seconds = parseInt(timeOffset.seconds || '0');
    const nanos = parseInt(timeOffset.nanos || '0');

    return seconds + nanos / 1000000000;
  }
}
