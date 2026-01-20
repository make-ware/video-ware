/**
 * Person Detection Executor
 *
 * Executes GCVI API calls for PERSON_DETECTION feature.
 * This is a pure strategy implementation with no database operations.
 */

import { Injectable, Logger } from '@nestjs/common';
import { GoogleCloudService } from '../../shared/services/google-cloud.service';
import type {
  PersonDetectionResponse,
  PersonFrame,
  PersonAttributes,
  PoseLandmark,
} from '../types/executor-responses';
import { protos } from '@google-cloud/video-intelligence';

/**
 * Configuration for person detection
 */
export interface PersonDetectionConfig {
  includeBoundingBoxes?: boolean; // default: true
  includePoseLandmarks?: boolean; // default: true
  includeAttributes?: boolean; // default: true
  confidenceThreshold?: number; // default: 0.7
  model?: string; // default: 'builtin/latest'
}

/**
 * Executor for Person Detection API calls
 */
@Injectable()
export class PersonDetectionExecutor {
  private readonly logger = new Logger(PersonDetectionExecutor.name);

  constructor(private readonly googleCloudService: GoogleCloudService) {}

  /**
   * Execute person detection on a video
   *
   * @param gcsUri - GCS URI of the video file (gs://bucket/path)
   * @param config - Person detection configuration
   * @returns Normalized person detection response
   */
  async execute(
    workspaceId: string,
    mediaId: string,
    config: PersonDetectionConfig = {}
  ): Promise<PersonDetectionResponse> {
    this.logger.log(`Executing person detection for media ${mediaId}`);
    const gcsUri = this.googleCloudService.getTempGcsUri(workspaceId, mediaId);

    try {
      // Use the authenticated client from GoogleCloudService
      const client = this.googleCloudService.getVideoIntelligenceClient();

      // Build request
      const request = {
        inputUri: gcsUri,
        features: [
          protos.google.cloud.videointelligence.v1.Feature.PERSON_DETECTION,
        ],
        videoContext: {
          personDetectionConfig: {
            includeBoundingBoxes: config.includeBoundingBoxes ?? true,
            includePoseLandmarks: config.includePoseLandmarks ?? true,
            includeAttributes: config.includeAttributes ?? true,
          },
        },
      };

      this.logger.debug(
        `Person detection request: ${JSON.stringify({
          gcsUri,
          includeBoundingBoxes: config.includeBoundingBoxes ?? true,
          includePoseLandmarks: config.includePoseLandmarks ?? true,
          includeAttributes: config.includeAttributes ?? true,
        })}`
      );

      // Execute API call
      const [operation] = await client.annotateVideo(request);
      this.logger.log(`Person detection operation started: ${operation.name}`);

      // Wait for operation to complete
      const [result] = await operation.promise();

      // Validate that we got a valid result
      if (!result) {
        const errorMsg =
          'Person detection operation completed but returned no result';
        this.logger.error(errorMsg);
        throw new Error(errorMsg);
      }

      // Validate annotation results exist
      if (!result.annotationResults || result.annotationResults.length === 0) {
        this.logger.warn(
          'No annotation results returned from person detection'
        );
        return {
          persons: [],
        };
      }

      const annotation = result.annotationResults[0];

      // Process person annotations
      const persons = (annotation.personDetectionAnnotations || []).map(
        (person, index) => {
          // Extract track ID from the first track (persons typically have one track)
          const track = person.tracks?.[0];
          const rawTrackId = (track as any)?.trackId;
          const trackId =
            rawTrackId !== undefined &&
            rawTrackId !== null &&
            String(rawTrackId) !== ''
              ? String(rawTrackId)
              : String(index);

          // Process frames with bounding boxes, attributes, and landmarks
          const frames: PersonFrame[] = (track?.timestampedObjects || []).map(
            (obj) => {
              const attributes: PersonAttributes = {};
              const landmarks: PoseLandmark[] = [];

              // Extract attributes if available
              if (config.includeAttributes && obj.attributes) {
                for (const attr of obj.attributes) {
                  const name = attr.name?.toLowerCase() || '';
                  const value = attr.value || '';

                  if (name === 'upper_clothing_color') {
                    attributes.upperClothingColor = value;
                  } else if (name === 'lower_clothing_color') {
                    attributes.lowerClothingColor = value;
                  }
                }
              }

              // Extract pose landmarks if available
              if (config.includePoseLandmarks && obj.landmarks) {
                for (const landmark of obj.landmarks) {
                  const point = landmark.point as any; // Use any to access z coordinate
                  landmarks.push({
                    type: landmark.name || '',
                    position: {
                      x: point?.x || 0,
                      y: point?.y || 0,
                      z: point?.z || 0, // z may not be in type definition but exists in API
                    },
                    confidence: landmark.confidence || 0,
                  });
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
                landmarks: landmarks.length > 0 ? landmarks : undefined,
              };
            }
          );

          return {
            trackId,
            frames,
          };
        }
      );

      // Apply confidence threshold if specified
      const threshold = config.confidenceThreshold ?? 0.7;
      const filteredPersons = persons.filter((person) => {
        // Check if any frame meets the confidence threshold
        return person.frames.some((frame) => frame.confidence >= threshold);
      });

      this.logger.log(
        `Person detection completed: ${filteredPersons.length} persons tracked ` +
          `(${persons.length - filteredPersons.length} filtered by confidence threshold)`
      );

      return {
        persons: filteredPersons,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Person detection failed: ${errorMessage}`);
      throw new Error(`Person detection execution failed: ${errorMessage}`);
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
