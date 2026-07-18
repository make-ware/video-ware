import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { LabelType, ProcessingProvider } from '@project/shared';
import type {
  TextDetectionResponse,
  NormalizerInput,
  NormalizerOutput,
  LabelEntityData,
  LabelTrackData,
  LabelTextData,
  KeyframeData,
} from '../types';

/** Round a number to `decimals` places (used to trim keyframe JSON size). */
function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Text Detection Normalizer
 *
 * Transforms GCVI Text Detection (on-screen OCR) responses into database
 * entities:
 * - LabelEntity: Unique text strings (labelType: text)
 * - LabelTrack: One per text appearance, with per-frame box keyframes
 * - LabelText: One row per appearance (text, timing, confidence)
 * - LabelMedia: Aggregated text counts
 */
@Injectable()
export class TextDetectionNormalizer {
  private readonly logger = new Logger(TextDetectionNormalizer.name);

  /**
   * Normalize text detection response into database entities
   *
   * @param input Normalizer input with response and context
   * @returns Normalized entities ready for database insertion
   */
  async normalize(
    input: NormalizerInput<TextDetectionResponse>
  ): Promise<NormalizerOutput> {
    const {
      response,
      mediaId,
      workspaceRef,
      taskRef,
      version,
      processorVersion,
    } = input;

    this.logger.debug(
      `Normalizing text detection response for media ${mediaId}: ${response.texts.length} text segments`
    );

    const labelEntities: LabelEntityData[] = [];
    const labelTracks: LabelTrackData[] = [];
    const labelTexts: LabelTextData[] = [];
    const seenLabels = new Set<string>();

    for (let i = 0; i < response.texts.length; i++) {
      const entry = response.texts[i];
      // One track per appearance. The API has no track ids for text, so the
      // index keeps appearances of the same string distinct.
      const trackId = `text_${i}`;

      // Create LabelEntity for this text string if not seen before
      const entityHash = this.generateEntityHash(
        workspaceRef,
        LabelType.TEXT,
        entry.text,
        ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE
      );

      if (!seenLabels.has(entityHash)) {
        labelEntities.push({
          WorkspaceRef: workspaceRef,
          labelType: LabelType.TEXT,
          canonicalName: entry.text,
          provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          processor: processorVersion,
          entityHash,
          metadata: {
            confidence: entry.confidence,
          },
        });
        seenLabels.add(entityHash);
      }

      // Keyframes from the per-frame boxes; rounded like the object-tracking
      // normalizer (4 decimals is sub-pixel even at 4K).
      const keyframes: KeyframeData[] = entry.frames.map((frame) => ({
        t: frame.timeOffset,
        bbox: {
          left: round(frame.boundingBox.left, 4),
          top: round(frame.boundingBox.top, 4),
          right: round(frame.boundingBox.right, 4),
          bottom: round(frame.boundingBox.bottom, 4),
        },
        confidence: round(entry.confidence, 3),
      }));

      // Timing comes from the segment itself; frames may be sparse.
      const start = entry.startTime;
      const end = entry.endTime;
      const duration = Math.max(0, end - start);

      const trackHash = this.generateTrackHash(
        mediaId,
        trackId,
        version,
        processorVersion
      );

      labelTracks.push({
        WorkspaceRef: workspaceRef,
        MediaRef: mediaId,
        TaskRef: taskRef,
        trackId,
        start,
        end,
        duration,
        confidence: entry.confidence,
        provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        processor: processorVersion,
        version,
        trackData: {
          entity: entry.text,
          frameCount: entry.frames.length,
        },
        keyframes,
        trackHash,
        // LabelEntityRef will be set by step processor
      });

      labelTexts.push({
        WorkspaceRef: workspaceRef,
        MediaRef: mediaId,
        text: entry.text,
        textHash: this.generateTextHash(
          mediaId,
          trackId,
          version,
          processorVersion
        ),
        originalTrackId: trackId,
        start,
        end,
        duration,
        confidence: entry.confidence,
        metadata: {
          taskRef,
          frameCount: entry.frames.length,
        },
        // LabelEntityRef and LabelTrackRef will be set by step processor
      });
    }

    this.logger.debug(
      `Normalized ${labelEntities.length} entities, ${labelTracks.length} tracks, ${labelTexts.length} texts`
    );

    return {
      labelEntities,
      labelTracks,
      labelClips: [], // Maintain interface compatibility but empty
      labelTexts,
      labelMediaUpdate: {
        textDetectionProcessedAt: new Date().toISOString(),
        textDetectionProcessor: processorVersion,
        textCount: labelTexts.length,
        textTrackCount: labelTracks.length,
        processors: ['text_detection'],
      },
    };
  }

  /**
   * Generate entity hash for deduplication
   */
  private generateEntityHash(
    workspaceRef: string,
    labelType: LabelType,
    canonicalName: string,
    provider: ProcessingProvider
  ): string {
    const normalizedName = canonicalName.trim().toLowerCase();
    const hashInput = `${workspaceRef}:${labelType}:${normalizedName}:${provider}`;
    return createHash('sha256').update(hashInput).digest('hex');
  }

  /**
   * Generate track hash for deduplication
   */
  private generateTrackHash(
    mediaId: string,
    trackId: string,
    version: number,
    processor: string
  ): string {
    const hashInput = `${mediaId}:${trackId}:${version}:${processor}`;
    return createHash('sha256').update(hashInput).digest('hex');
  }

  /**
   * Generate text-row hash for deduplication (stable across re-runs of the
   * same media/version/processor, like objectHash for tracked objects).
   */
  private generateTextHash(
    mediaId: string,
    trackId: string,
    version: number,
    processor: string
  ): string {
    const hashInput = `${mediaId}:${trackId}:${version}:${processor}:text`;
    return createHash('sha256').update(hashInput).digest('hex');
  }
}
