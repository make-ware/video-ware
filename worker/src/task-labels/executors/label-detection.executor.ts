/**
 * Label Detection Executor
 *
 * Executes GCVI API calls for LABEL_DETECTION and SHOT_CHANGE_DETECTION features.
 * This is a pure strategy implementation with no database operations.
 */

import { Injectable, Logger } from '@nestjs/common';
import { GoogleCloudService } from '../../shared/services/google-cloud.service';
import type { LabelDetectionResponse } from '../types/executor-responses';
import { protos } from '@google-cloud/video-intelligence';

const LabelDetectionMode =
  protos.google.cloud.videointelligence.v1.LabelDetectionMode;

/**
 * Configuration for label detection
 */
export interface LabelDetectionConfig {
  labelDetectionMode?: 'SHOT_MODE' | 'SHOT_AND_FRAME_MODE' | 'FRAME_MODE';
  videoConfidenceThreshold?: number; // default: 0.2
  stationaryCamera?: boolean; // default: false
}

/**
 * Executor for Label Detection API calls
 */
@Injectable()
export class LabelDetectionExecutor {
  private readonly logger = new Logger(LabelDetectionExecutor.name);

  constructor(private readonly googleCloudService: GoogleCloudService) {}

  /**
   * Execute label detection on a video
   *
   * @param gcsUri - GCS URI of the video file (gs://bucket/path)
   * @param config - Label detection configuration
   * @returns Normalized label detection response
   */
  async execute(
    workspaceId: string,
    mediaId: string,
    config: LabelDetectionConfig = {}
  ): Promise<LabelDetectionResponse> {
    this.logger.log(`Executing label detection for media ${mediaId}`);
    const gcsUri = this.googleCloudService.getTempGcsUri(workspaceId, mediaId);

    try {
      // Use the authenticated client from GoogleCloudService
      const client = this.googleCloudService.getVideoIntelligenceClient();

      // Map string mode to enum
      const modeMap = {
        SHOT_MODE: LabelDetectionMode.SHOT_MODE,
        SHOT_AND_FRAME_MODE: LabelDetectionMode.SHOT_AND_FRAME_MODE,
        FRAME_MODE: LabelDetectionMode.FRAME_MODE,
      };

      const detectionMode = config.labelDetectionMode
        ? modeMap[config.labelDetectionMode]
        : LabelDetectionMode.SHOT_AND_FRAME_MODE;

      // Build request
      const request = {
        inputUri: gcsUri,
        features: [
          protos.google.cloud.videointelligence.v1.Feature.LABEL_DETECTION,
          protos.google.cloud.videointelligence.v1.Feature
            .SHOT_CHANGE_DETECTION,
        ],
        videoContext: {
          labelDetectionConfig: {
            labelDetectionMode: detectionMode,
            stationaryCamera: config.stationaryCamera ?? false,
          },
        },
      };

      this.logger.debug(
        `Label detection request: ${JSON.stringify({
          gcsUri,
          mode: config.labelDetectionMode || 'SHOT_AND_FRAME_MODE',
          stationaryCamera: config.stationaryCamera ?? false,
        })}`
      );

      // Execute API call
      const [operation] = await client.annotateVideo(request);
      this.logger.log(`Label detection operation started: ${operation.name}`);

      // Wait for operation to complete
      // Note: operation.promise() will throw if the operation fails (e.g., file not found)
      const [result] = await operation.promise();

      // Validate that we got a valid result
      if (!result) {
        const errorMsg =
          'Label detection operation completed but returned no result';
        this.logger.error(errorMsg);
        throw new Error(errorMsg);
      }

      // Validate annotation results exist
      if (!result.annotationResults || result.annotationResults.length === 0) {
        this.logger.warn('No annotation results returned from label detection');
        return {
          segmentLabels: [],
          shotLabels: [],
          shots: [],
        };
      }

      const annotation = result.annotationResults[0];

      // Process segment labels (video-level labels)
      const segmentLabels = (annotation.segmentLabelAnnotations || []).map(
        (label) => ({
          entity: label.entity?.description || '',
          confidence: this.calculateAverageConfidence(label.segments || []),
          segments: (label.segments || []).map((segment) => ({
            startTime: this.parseTimeOffset(segment.segment?.startTimeOffset),
            endTime: this.parseTimeOffset(segment.segment?.endTimeOffset),
            confidence: segment.confidence || 0,
          })),
        })
      );

      // Process shot labels (shot-level labels)
      const shotLabels = (annotation.shotLabelAnnotations || []).map(
        (label) => ({
          entity: label.entity?.description || '',
          confidence: this.calculateAverageConfidence(label.segments || []),
          segments: (label.segments || []).map((segment) => ({
            startTime: this.parseTimeOffset(segment.segment?.startTimeOffset),
            endTime: this.parseTimeOffset(segment.segment?.endTimeOffset),
            confidence: segment.confidence || 0,
          })),
        })
      );

      // Process shots (scene changes)
      const shots = (annotation.shotAnnotations || []).map((shot) => ({
        startTime: this.parseTimeOffset(shot.startTimeOffset),
        endTime: this.parseTimeOffset(shot.endTimeOffset),
      }));

      // Apply confidence threshold if specified
      const threshold = config.videoConfidenceThreshold ?? 0.2;
      const filteredSegmentLabels = segmentLabels.filter(
        (label) => label.confidence >= threshold
      );
      const filteredShotLabels = shotLabels.filter(
        (label) => label.confidence >= threshold
      );

      this.logger.log(
        `Label detection completed: ${filteredSegmentLabels.length} segment labels, ` +
          `${filteredShotLabels.length} shot labels, ${shots.length} shots`
      );

      return {
        segmentLabels: filteredSegmentLabels,
        shotLabels: filteredShotLabels,
        shots,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Log additional context for debugging
      this.logger.error(
        `Label detection failed for media ${mediaId} (GCS URI: ${this.googleCloudService.getTempGcsUri(workspaceId, mediaId)}): ${errorMessage}`
      );

      // Check if it's a NOT_FOUND error (file doesn't exist in GCS)
      if (
        errorMessage.includes('NOT_FOUND') ||
        errorMessage.includes('not found')
      ) {
        throw new Error(
          `Label detection failed: GCS file not found. Please ensure the video file exists at the expected location. Original error: ${errorMessage}`
        );
      }

      throw new Error(`Label detection execution failed: ${errorMessage}`);
    }
  }

  /**
   * Parse Google Cloud time offset to seconds
   */
  private parseTimeOffset(timeOffset: unknown): number {
    if (!timeOffset) return 0;

    const t = timeOffset as { seconds?: string | number; nanos?: number };
    const seconds = parseInt(String(t.seconds || '0'));
    const nanos = parseInt(String(t.nanos || '0'));

    return seconds + nanos / 1000000000;
  }

  /**
   * Calculate average confidence from segments
   */
  private calculateAverageConfidence(
    segments: { confidence?: number | null }[]
  ): number {
    if (!segments || segments.length === 0) return 0;

    const sum = segments.reduce((acc, seg) => acc + (seg.confidence || 0), 0);
    return sum / segments.length;
  }
}
