/**
 * Text Detection Executor
 *
 * Executes GCVI API calls for TEXT_DETECTION (on-screen text OCR).
 * This is a pure strategy implementation with no database operations.
 */

import { Injectable, Logger } from '@nestjs/common';
import { GoogleCloudService } from '../../shared/services/google-cloud.service';
import type {
  TextDetectionResponse,
  TextFrame,
} from '../types/executor-responses';
import { protos } from '@google-cloud/video-intelligence';

/**
 * Configuration for text detection
 */
export interface TextDetectionConfig {
  /** BCP-47 language hints for OCR (e.g. ['en-US']); auto-detect when unset */
  languageHints?: string[];
  /**
   * Minimum confidence for cleaned runs. Applied by the normalizer, not
   * here — the executor's response is cached and must stay raw so
   * thresholds can be re-tuned without new API calls.
   */
  confidenceThreshold?: number;
}

/**
 * Executor for Text Detection API calls
 */
@Injectable()
export class TextDetectionExecutor {
  private readonly logger = new Logger(TextDetectionExecutor.name);

  constructor(private readonly googleCloudService: GoogleCloudService) {}

  /**
   * Execute text detection on a video
   *
   * @param workspaceId - Workspace record ID (locates the GCS temp upload)
   * @param mediaId - Media record ID
   * @param config - Text detection configuration
   * @returns Normalized text detection response
   */
  async execute(
    workspaceId: string,
    mediaId: string,
    config: TextDetectionConfig = {}
  ): Promise<TextDetectionResponse> {
    this.logger.log(`Executing text detection for media ${mediaId}`);
    const gcsUri = this.googleCloudService.getTempGcsUri(workspaceId, mediaId);

    try {
      // Build request
      const request = {
        inputUri: gcsUri,
        features: [
          protos.google.cloud.videointelligence.v1.Feature.TEXT_DETECTION,
        ],
        videoContext: {
          textDetectionConfig: {
            languageHints: config.languageHints ?? [],
          },
        },
      };

      this.logger.debug(
        `Text detection request: ${JSON.stringify({
          gcsUri,
          languageHints: config.languageHints ?? [],
        })}`
      );

      // Execute API call and await the operation with quota-aware polling
      const result =
        await this.googleCloudService.annotateVideoAndWait(request);

      // Validate that we got a valid result
      if (!result) {
        const errorMsg =
          'Text detection operation completed but returned no result';
        this.logger.error(errorMsg);
        throw new Error(errorMsg);
      }

      // Validate annotation results exist
      if (!result.annotationResults || result.annotationResults.length === 0) {
        this.logger.warn('No annotation results returned from text detection');
        return { texts: [] };
      }

      const annotation = result.annotationResults[0];

      // Flatten annotations: one entry per (text × appearance segment). The
      // same string can appear on screen several times; each segment is an
      // independent appearance with its own timing, confidence, and frames.
      const texts = (annotation.textAnnotations || []).flatMap(
        (textAnnotation) => {
          const text = (textAnnotation.text || '').trim();
          if (!text) return [];

          return (textAnnotation.segments || []).map((segment) => ({
            text,
            confidence: segment.confidence || 0,
            startTime: this.parseTimeOffset(segment.segment?.startTimeOffset),
            endTime: this.parseTimeOffset(segment.segment?.endTimeOffset),
            frames: (segment.frames || []).map((frame) =>
              this.toTextFrame(frame)
            ),
          }));
        }
      );

      // No filtering here: this response gets cached, and the normalizer's
      // cleaning pass (merge/duration/confidence/dedup) works off the raw
      // segments so thresholds can change without re-calling the API.
      this.logger.log(
        `Text detection completed: ${texts.length} raw text segments`
      );

      return { texts };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Text detection failed for media ${mediaId} (GCS URI: ${gcsUri}): ${errorMessage}`
      );

      if (
        errorMessage.includes('NOT_FOUND') ||
        errorMessage.includes('not found')
      ) {
        throw new Error(
          `Text detection failed: GCS file not found. Please ensure the video file exists at the expected location. Original error: ${errorMessage}`
        );
      }

      throw new Error(`Text detection execution failed: ${errorMessage}`);
    }
  }

  /**
   * Convert a GCVI text frame to our normalized frame shape.
   *
   * The API returns a rotated quad (four normalized vertices); downstream
   * consumers (LabelTrack keyframes, the webapp overlay) work with
   * axis-aligned boxes, so we take the quad's extremes.
   */
  private toTextFrame(
    frame: protos.google.cloud.videointelligence.v1.ITextFrame
  ): TextFrame {
    const vertices = frame.rotatedBoundingBox?.vertices || [];
    const xs = vertices.map((v) => v.x || 0);
    const ys = vertices.map((v) => v.y || 0);

    return {
      timeOffset: this.parseTimeOffset(frame.timeOffset),
      boundingBox: {
        left: xs.length ? Math.min(...xs) : 0,
        top: ys.length ? Math.min(...ys) : 0,
        right: xs.length ? Math.max(...xs) : 0,
        bottom: ys.length ? Math.max(...ys) : 0,
      },
    };
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
}
