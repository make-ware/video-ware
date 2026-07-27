import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { labelEntityKey, LabelType, ProcessingProvider } from '@project/shared';
import type {
  LabelDetectionResponse,
  NormalizerInput,
  NormalizerOutput,
  LabelEntityData,
  LabelClipData,
  LabelMediaData,
  LabelSegmentData,
  LabelShotData,
} from '../types';

/**
 * Label Detection Normalizer
 *
 * Transforms GCVI Label Detection API responses into database entities:
 * - LabelEntity: Unique labels (segment labels and shot labels)
 * - LabelMedia: Aggregated label counts and shot counts
 *
 * This normalizer handles:
 * - Segment labels (video-level labels)
 * - Shot labels (shot-level labels)
 * - Shot boundaries (scene changes)
 */
@Injectable()
export class LabelDetectionNormalizer {
  private readonly logger = new Logger(LabelDetectionNormalizer.name);

  /**
   * Normalize label detection response into database entities
   *
   * @param input Normalizer input with response and context
   * @returns Normalized entities ready for database insertion
   */
  async normalize(
    input: NormalizerInput<LabelDetectionResponse>
  ): Promise<NormalizerOutput> {
    const {
      response,
      mediaId,
      workspaceRef,
      taskRef,
      version,
      processor: _processor,
      processorVersion,
    } = input;

    this.logger.debug(
      `Normalizing label detection response for media ${mediaId}`
    );

    // Collect unique labels for LabelEntity creation
    const labelEntities: LabelEntityData[] = [];
    const labelClips: LabelClipData[] = [];
    const labelSegments: LabelSegmentData[] = [];
    const labelShots: LabelShotData[] = [];

    // Process segment labels
    for (const segmentLabel of response.segmentLabels) {
      // Create LabelSegment for each segment
      for (const segment of segmentLabel.segments) {
        const segmentHash = this.generateSegmentHash(
          mediaId,
          segment.startTime,
          segment.endTime,
          segmentLabel.entity
        );

        // Segments have no provider track, so the row itself is the instance
        // and its own hash is the instance key — one LabelEntity per segment,
        // each independently linkable to a real-world Entity.
        const entityHash = labelEntityKey({
          workspaceRef,
          mediaId,
          labelType: LabelType.SEGMENT,
          instanceId: segmentHash,
          provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        });

        labelEntities.push({
          WorkspaceRef: workspaceRef,
          MediaRef: mediaId,
          labelType: LabelType.SEGMENT,
          canonicalName: segmentLabel.entity,
          instanceId: segmentHash,
          provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          processor: processorVersion,
          entityHash,
          metadata: {
            confidence: this.clamp01(segmentLabel.confidence),
          },
        });

        labelSegments.push({
          WorkspaceRef: workspaceRef,
          MediaRef: mediaId,
          entity: segmentLabel.entity,
          segmentHash,
          labelType: LabelType.SEGMENT,
          start: segment.startTime,
          end: segment.endTime,
          duration: segment.endTime - segment.startTime,
          confidence: this.clamp01(
            segment.confidence ?? segmentLabel.confidence
          ),
          version,
          metadata: {
            processor: processorVersion,
            provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
            taskRef,
            entityHash,
          },
        });

        // Also create a LabelClip for backward compatibility/general usage
        const clipHash = this.generateClipHash(
          mediaId,
          segment.startTime,
          segment.endTime,
          LabelType.SEGMENT
        );

        labelClips.push({
          WorkspaceRef: workspaceRef,
          MediaRef: mediaId,
          TaskRef: taskRef,
          labelHash: clipHash,
          labelType: LabelType.SEGMENT,
          type: segmentLabel.entity,
          start: segment.startTime,
          end: segment.endTime,
          duration: segment.endTime - segment.startTime,
          confidence: this.clamp01(
            segment.confidence ?? segmentLabel.confidence
          ),
          version,
          processor: processorVersion,
          provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          labelData: {
            entity: segmentLabel.entity,
            segmentType: 'segment',
          },
        });
      }
    }

    // Process shot labels
    for (const shotLabel of response.shotLabels) {
      // Create LabelShot for each shot segment
      for (const segment of shotLabel.segments) {
        const shotHash = this.generateShotHash(
          mediaId,
          segment.startTime,
          segment.endTime,
          shotLabel.entity
        );

        // Same as segments: no provider track, so the row is the instance.
        const entityHash = labelEntityKey({
          workspaceRef,
          mediaId,
          labelType: LabelType.SHOT,
          instanceId: shotHash,
          provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        });

        labelEntities.push({
          WorkspaceRef: workspaceRef,
          MediaRef: mediaId,
          labelType: LabelType.SHOT,
          canonicalName: shotLabel.entity,
          instanceId: shotHash,
          provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          processor: processorVersion,
          entityHash,
          metadata: {
            confidence: this.clamp01(shotLabel.confidence),
          },
        });

        labelShots.push({
          WorkspaceRef: workspaceRef,
          MediaRef: mediaId,
          entity: shotLabel.entity,
          shotHash,
          labelType: LabelType.SHOT,
          start: segment.startTime,
          end: segment.endTime,
          duration: segment.endTime - segment.startTime,
          confidence: this.clamp01(segment.confidence ?? shotLabel.confidence),
          version,
          metadata: {
            processor: processorVersion,
            provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
            taskRef,
            entityHash,
          },
        });

        // Also create a LabelClip
        const clipHash = this.generateClipHash(
          mediaId,
          segment.startTime,
          segment.endTime,
          LabelType.SHOT
        );

        labelClips.push({
          WorkspaceRef: workspaceRef,
          MediaRef: mediaId,
          TaskRef: taskRef,
          labelHash: clipHash,
          labelType: LabelType.SHOT,
          type: shotLabel.entity,
          start: segment.startTime,
          end: segment.endTime,
          duration: segment.endTime - segment.startTime,
          confidence: this.clamp01(segment.confidence ?? shotLabel.confidence),
          version,
          processor: processorVersion,
          provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          labelData: {
            entity: shotLabel.entity,
            segmentType: 'shot_label',
          },
        });
      }
    }

    // Process shots (scene changes)
    //
    // No LabelEntity is emitted here. Scene changes produce only labelClips,
    // which nothing persists — there is no LabelClips collection and no
    // processor reads the field (it is kept solely for interface
    // compatibility). The generic "Shot" entity this used to emit was
    // therefore never referenced by any row; it is the unreferenced orphan the
    // per-instance migration cleans up.
    for (const shot of response.shots) {
      // Create LabelClip for each shot boundary
      const clipHash = this.generateClipHash(
        mediaId,
        shot.startTime,
        shot.endTime,
        LabelType.SHOT
      );

      labelClips.push({
        WorkspaceRef: workspaceRef,
        MediaRef: mediaId,
        TaskRef: taskRef,
        labelHash: clipHash,
        labelType: LabelType.SHOT,
        type: 'Shot',
        start: shot.startTime,
        end: shot.endTime,
        duration: shot.endTime - shot.startTime,
        confidence: 1.0,
        version,
        processor: processorVersion,
        provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        labelData: {
          entity: 'Shot',
          segmentType: 'shot_boundary',
        },
      });
    }

    // Create LabelMedia update with aggregated counts
    const labelMediaUpdate: Partial<LabelMediaData> = {
      labelDetectionProcessedAt: new Date().toISOString(),
      labelDetectionProcessor: processorVersion,
      segmentLabelCount: response.segmentLabels.reduce(
        (sum, label) => sum + label.segments.length,
        0
      ),
      shotLabelCount: response.shotLabels.reduce(
        (sum, label) => sum + label.segments.length,
        0
      ),
      shotCount: response.shots.length,
      // Add processor to processors array
      processors: ['label_detection'],
    };

    this.logger.debug(
      `Normalized ${labelEntities.length} entities, ${labelSegments.length} segments, ${labelShots.length} shots`
    );

    return {
      labelEntities,
      labelTracks: [],
      labelClips,
      labelSegments,
      labelShots,
      labelMediaUpdate,
    };
  }

  /**
   * Clamp a confidence score into the [0, 1] range required by the DB schema.
   * GCVI occasionally returns values marginally above 1.0 (floating-point
   * rounding), which would otherwise fail Zod validation and drop the label.
   * Non-finite values (NaN/undefined-derived) collapse to 0.
   */
  private clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
  }

  /**
   * Generate clip hash for deduplication
   */
  private generateClipHash(
    mediaId: string,
    start: number,
    end: number,
    labelType: LabelType
  ): string {
    const hashInput = `${mediaId}:${start.toFixed(1)}:${end.toFixed(1)}:${labelType}`;
    return createHash('sha256').update(hashInput).digest('hex');
  }

  /**
   * Generate segment hash for deduplication
   */
  private generateSegmentHash(
    mediaId: string,
    start: number,
    end: number,
    entity: string
  ): string {
    const normalizedEntity = entity.trim().toLowerCase();
    const hashInput = `${mediaId}:${start.toFixed(1)}:${end.toFixed(1)}:segment:${normalizedEntity}`;
    return createHash('sha256').update(hashInput).digest('hex');
  }

  /**
   * Generate shot hash for deduplication
   */
  private generateShotHash(
    mediaId: string,
    start: number,
    end: number,
    entity: string
  ): string {
    const normalizedEntity = entity.trim().toLowerCase();
    const hashInput = `${mediaId}:${start.toFixed(1)}:${end.toFixed(1)}:shot:${normalizedEntity}`;
    return createHash('sha256').update(hashInput).digest('hex');
  }
}
