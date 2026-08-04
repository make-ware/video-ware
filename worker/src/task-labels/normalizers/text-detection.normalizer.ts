import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  labelEntityKey,
  unionBbox,
  LabelType,
  ProcessingProvider,
} from '@project/shared';
import type {
  TextDetectionResponse,
  NormalizerInput,
  NormalizerOutput,
  LabelEntityData,
  LabelTrackData,
  LabelTextData,
  KeyframeData,
} from '../types';
import {
  cleanDetectedTexts,
  type CleanedTextRun,
  type TextCleaningOptions,
} from '../utils/text-cleaning';

/** Round a number to `decimals` places (used to trim keyframe JSON size). */
function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Text Detection Normalizer
 *
 * Transforms GCVI Text Detection (on-screen OCR) responses into database
 * entities. The raw response is cleaned first (see utils/text-cleaning.ts):
 * fragmented appearances of the same string are merged, and sub-second
 * flickers, low-confidence misreads, and contained fragments are dropped.
 * Cleaning runs here — after the cache layer — so thresholds can change and
 * re-apply to cached responses without new API calls.
 *
 * - LabelEntity: Unique text strings (labelType: text)
 * - LabelTrack: One per merged appearance, with per-frame box keyframes
 * - LabelText: One row per merged appearance (text, timing, confidence)
 * - LabelMedia: Aggregated text counts
 */
@Injectable()
export class TextDetectionNormalizer {
  private readonly logger = new Logger(TextDetectionNormalizer.name);

  /**
   * Normalize text detection response into database entities
   *
   * @param input Normalizer input with response and context
   * @param cleaningOptions Threshold overrides for the cleaning pass
   * @returns Normalized entities ready for database insertion
   */
  async normalize(
    input: NormalizerInput<TextDetectionResponse>,
    cleaningOptions?: Partial<TextCleaningOptions>
  ): Promise<NormalizerOutput> {
    const {
      response,
      mediaId,
      workspaceRef,
      taskRef,
      version,
      processorVersion,
    } = input;

    const runs = cleanDetectedTexts(response.texts, cleaningOptions);

    this.logger.debug(
      `Normalizing text detection response for media ${mediaId}: ` +
        `${response.texts.length} raw segments → ${runs.length} cleaned runs`
    );

    const labelEntities: LabelEntityData[] = [];
    const labelTracks: LabelTrackData[] = [];
    const labelTexts: LabelTextData[] = [];

    for (const run of runs) {
      // Content-based track id: the same detection re-run on the same
      // media/version maps to the same id (and thus the same hashes), so
      // re-processing upserts instead of duplicating rows. Merged runs of the
      // same string can't collide — they'd have been merged if they touched.
      const trackId = this.generateRunTrackId(run);

      // One LabelEntity per detected run. The run track id is content-based,
      // so re-running the detection upserts the same rows rather than
      // duplicating them.
      const entityHash = labelEntityKey({
        workspaceRef,
        mediaId,
        labelType: LabelType.TEXT,
        instanceId: trackId,
        provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
      });

      labelEntities.push({
        WorkspaceRef: workspaceRef,
        MediaRef: mediaId,
        labelType: LabelType.TEXT,
        canonicalName: run.text,
        instanceId: trackId,
        provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        processor: processorVersion,
        entityHash,
        metadata: {
          confidence: run.confidence,
        },
      });

      // Keyframes from the per-frame boxes; rounded like the object-tracking
      // normalizer (4 decimals is sub-pixel even at 4K).
      const keyframes: KeyframeData[] = run.frames.map((frame) => ({
        t: frame.timeOffset,
        bbox: {
          left: round(frame.boundingBox.left, 4),
          top: round(frame.boundingBox.top, 4),
          right: round(frame.boundingBox.right, 4),
          bottom: round(frame.boundingBox.bottom, 4),
        },
        confidence: round(run.confidence, 3),
      }));

      const start = run.start;
      const end = run.end;
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
        confidence: run.confidence,
        provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        processor: processorVersion,
        version,
        trackData: {
          entity: run.text,
          frameCount: run.frames.length,
          segmentCount: run.segmentCount,
        },
        keyframes,
        // The path's footprint, so spatial reads never open the keyframes blob.
        boundingBox: unionBbox(keyframes) ?? undefined,
        trackHash,
        labelType: LabelType.TEXT,
        // LabelEntityRef will be set by step processor
      });

      labelTexts.push({
        WorkspaceRef: workspaceRef,
        MediaRef: mediaId,
        text: run.text,
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
        confidence: run.confidence,
        metadata: {
          taskRef,
          frameCount: run.frames.length,
          segmentCount: run.segmentCount,
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
   * Track id for a cleaned run, derived from its content (normalized text +
   * start time on the ms grid) instead of an array index, so identity is
   * stable across re-runs and threshold changes.
   */
  private generateRunTrackId(run: CleanedTextRun): string {
    const textHash = createHash('sha256')
      .update(run.normalizedText)
      .digest('hex')
      .slice(0, 12);
    return `text_${textHash}_${Math.round(run.start * 1000)}`;
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
