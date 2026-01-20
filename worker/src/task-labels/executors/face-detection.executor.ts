/**
 * Face Detection Executor
 *
 * Executes GCVI API calls for FACE_DETECTION feature.
 * This is a pure strategy implementation with no database operations.
 */

import { Injectable, Logger } from '@nestjs/common';
import { GoogleCloudService } from '../../shared/services/google-cloud.service';
import type {
  FaceDetectionResponse,
  FaceFrame,
  FaceAttributes,
} from '../types/executor-responses';
import { protos } from '@google-cloud/video-intelligence';

/**
 * Configuration for face detection
 */
export interface FaceDetectionConfig {
  includeBoundingBoxes?: boolean; // default: true
  includeAttributes?: boolean; // default: true
  confidenceThreshold?: number; // default: 0.7
  model?: string; // default: 'builtin/latest'
  includeThumbnails?: boolean; // default: true
}

/**
 * Executor for Face Detection API calls
 */
@Injectable()
export class FaceDetectionExecutor {
  private readonly logger = new Logger(FaceDetectionExecutor.name);

  constructor(private readonly googleCloudService: GoogleCloudService) {}

  /**
   * Execute face detection on a video
   *
   * @param gcsUri - GCS URI of the video file (gs://bucket/path)
   * @param config - Face detection configuration
   * @returns Normalized face detection response
   */
  async execute(
    workspaceId: string,
    mediaId: string,
    config: FaceDetectionConfig = {}
  ): Promise<FaceDetectionResponse> {
    this.logger.log(`Executing face detection for media ${mediaId}`);
    const gcsUri = this.googleCloudService.getTempGcsUri(workspaceId, mediaId);

    try {
      // Use the authenticated client from GoogleCloudService
      const client = this.googleCloudService.getVideoIntelligenceClient();

      // Build request
      const request = {
        inputUri: gcsUri,
        features: [
          protos.google.cloud.videointelligence.v1.Feature.FACE_DETECTION,
        ],
        videoContext: {
          faceDetectionConfig: {
            model: config.model || 'builtin/latest',
            includeBoundingBoxes: config.includeBoundingBoxes ?? true,
            includeAttributes: config.includeAttributes ?? true,
            includeThumbnails: config.includeThumbnails ?? true,
          },
        },
      };

      this.logger.debug(
        `Face detection request: ${JSON.stringify({
          gcsUri,
          model: config.model || 'builtin/latest',
          includeBoundingBoxes: config.includeBoundingBoxes ?? true,
          includeAttributes: config.includeAttributes ?? true,
        })}`
      );

      // Execute API call
      const [operation] = await client.annotateVideo(request);
      this.logger.log(`Face detection operation started: ${operation.name}`);

      // Wait for operation to complete
      const [result] = await operation.promise();

      // Validate that we got a valid result
      if (!result) {
        const errorMsg =
          'Face detection operation completed but returned no result';
        this.logger.error(errorMsg);
        throw new Error(errorMsg);
      }

      // Validate annotation results exist
      if (!result.annotationResults || result.annotationResults.length === 0) {
        this.logger.warn('No annotation results returned from face detection');
        return {
          faces: [],
        };
      }

      const annotation = result.annotationResults[0];

      // Process face annotations
      const faces = (annotation.faceDetectionAnnotations || []).map(
        (face, index) => {
          // Extract track ID from the first track (faces typically have one track)
          const track = face.tracks?.[0];
          const rawTrackId = (track as any)?.trackId;
          const trackId =
            rawTrackId !== undefined &&
            rawTrackId !== null &&
            String(rawTrackId) !== ''
              ? String(rawTrackId)
              : String(index);

          const faceId = (face as any).faceId;
          const thumbnail = face.thumbnail
            ? (face.thumbnail as Buffer).toString('base64')
            : undefined;

          // Process frames with bounding boxes and attributes
          const frames: FaceFrame[] = (track?.timestampedObjects || []).map(
            (obj) => {
              const attributes: FaceAttributes = {};

              // Extract attributes if available
              if (config.includeAttributes && obj.attributes) {
                for (const attr of obj.attributes) {
                  const name = attr.name?.toLowerCase() || '';
                  const value = attr.value || '';

                  if (name === 'joy_likelihood') {
                    attributes.joyLikelihood = value;
                  } else if (name === 'sorrow_likelihood') {
                    attributes.sorrowLikelihood = value;
                  } else if (name === 'anger_likelihood') {
                    attributes.angerLikelihood = value;
                  } else if (name === 'surprise_likelihood') {
                    attributes.surpriseLikelihood = value;
                  } else if (name === 'under_exposed_likelihood') {
                    attributes.underExposedLikelihood = value;
                  } else if (name === 'blurred_likelihood') {
                    attributes.blurredLikelihood = value;
                  } else if (name === 'headwear_likelihood') {
                    attributes.headwearLikelihood = value;
                  } else if (
                    name === 'looking_at_camera_likelihood' ||
                    name === 'looking_at_camera'
                  ) {
                    attributes.lookingAtCameraLikelihood = value;
                  }
                }
              }

              return {
                timeOffset: this.parseTimeOffset(obj.timeOffset),
                boundingBox: {
                  left: obj.normalizedBoundingBox?.left || 0,
                  top: obj.normalizedBoundingBox?.top || 0,
                  right: obj.normalizedBoundingBox?.right || 0,
                  bottom: obj.normalizedBoundingBox?.bottom || 0,
                },
                confidence: track?.confidence || 0,
                attributes:
                  Object.keys(attributes).length > 0 ? attributes : undefined,
              };
            }
          );

          return {
            trackId,
            faceId,
            thumbnail,
            frames,
          };
        }
      );

      // Apply confidence threshold if specified
      const threshold = config.confidenceThreshold ?? 0.7;
      const filteredFaces = faces.filter((face) => {
        // Check if any frame meets the confidence threshold
        return face.frames.some((frame) => frame.confidence >= threshold);
      });

      this.logger.log(
        `Face detection completed: ${filteredFaces.length} faces tracked ` +
          `(${faces.length - filteredFaces.length} filtered by confidence threshold)`
      );

      return {
        faces: filteredFaces,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Face detection failed: ${errorMessage}`);
      throw new Error(`Face detection execution failed: ${errorMessage}`);
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
