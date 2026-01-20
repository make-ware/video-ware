import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { LabelType, ProcessingProvider } from '@project/shared';
import type {
  ObjectTrackingResponse,
  NormalizerInput,
  NormalizerOutput,
  LabelEntityData,
  LabelTrackData,
  LabelObjectData,
  KeyframeData,
} from '../types';

/**
 * Object Tracking Normalizer
 *
 * Transforms GCVI Object Tracking API responses into database entities:
 * - LabelEntity: Unique object types (e.g., "Car", "Person", "Dog")
 * - LabelTrack: Tracked objects with keyframe data (bounding boxes over time)
 * - LabelMedia: Aggregated object counts
 *
 * This normalizer handles:
 * - Object detection and tracking
 * - Keyframe extraction with bounding boxes
 * - Track-level confidence aggregation
 */
@Injectable()
export class ObjectTrackingNormalizer {
  private readonly logger = new Logger(ObjectTrackingNormalizer.name);

  // Configuration for clip filtering
  private readonly MIN_CLIP_DURATION = 0.5; // seconds
  private readonly MIN_CLIP_CONFIDENCE = 0.3;

  /**
   * Normalize object tracking response into database entities
   *
   * @param input Normalizer input with response and context
   * @returns Normalized entities ready for database insertion
   */
  async normalize(
    input: NormalizerInput<ObjectTrackingResponse>
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
      `Normalizing object tracking response for media ${mediaId}: ${response.objects.length} objects`
    );

    const labelEntities: LabelEntityData[] = [];
    const labelTracks: LabelTrackData[] = [];
    const labelObjects: LabelObjectData[] = [];
    const seenLabels = new Set<string>();

    // Process each tracked object
    for (let i = 0; i < response.objects.length; i++) {
      const obj = response.objects[i];
      // Generate a unique trackId for this specific object segment/track
      // GCVI often returns "0" for many tracks, so we append the index.
      const uniqueTrackId = `${obj.trackId}_${i}`;

      // Create LabelEntity for this object type if not seen before
      const entityHash = this.generateEntityHash(
        workspaceRef,
        LabelType.OBJECT,
        obj.entity,
        ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE
      );

      if (!seenLabels.has(entityHash)) {
        labelEntities.push({
          WorkspaceRef: workspaceRef,
          labelType: LabelType.OBJECT,
          canonicalName: obj.entity,
          provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          processor: processorVersion,
          entityHash,
          metadata: {
            trackingConfidence: obj.confidence,
          },
        });
        seenLabels.add(entityHash);
      }

      // Extract keyframes from frames
      const keyframes: KeyframeData[] = obj.frames.map((frame) => ({
        t: frame.timeOffset,
        bbox: {
          left: frame.boundingBox.left,
          top: frame.boundingBox.top,
          right: frame.boundingBox.right,
          bottom: frame.boundingBox.bottom,
        },
        confidence: frame.confidence,
      }));

      // Calculate track start, end, and duration
      const start = obj.frames[0]?.timeOffset ?? 0;
      const end = obj.frames[obj.frames.length - 1]?.timeOffset ?? 0;
      const duration = end - start;

      // Calculate average confidence
      const avgConfidence =
        obj.frames.reduce((sum, frame) => sum + frame.confidence, 0) /
        obj.frames.length;

      // Generate track hash
      const trackHash = this.generateTrackHash(
        mediaId,
        uniqueTrackId,
        version,
        processorVersion
      );

      // Create LabelTrack with keyframes
      labelTracks.push({
        WorkspaceRef: workspaceRef,
        MediaRef: mediaId,
        TaskRef: taskRef,
        trackId: uniqueTrackId,
        start,
        end,
        duration,
        confidence: avgConfidence,
        provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        processor: processorVersion,
        version,
        trackData: {
          entity: obj.entity,
          frameCount: obj.frames.length,
          maxConfidence: Math.max(...obj.frames.map((f) => f.confidence)),
          minConfidence: Math.min(...obj.frames.map((f) => f.confidence)),
        },
        keyframes,
        trackHash,
        // LabelEntityRef will be set by step processor
      });

      // Create LabelObject if track meets minimum criteria
      if (
        duration >= this.MIN_CLIP_DURATION &&
        avgConfidence >= this.MIN_CLIP_CONFIDENCE
      ) {
        const objectHash = this.generateObjectHash(
          mediaId,
          uniqueTrackId,
          version,
          processorVersion
        );

        labelObjects.push({
          WorkspaceRef: workspaceRef,
          MediaRef: mediaId,
          labelType: LabelType.OBJECT,
          entity: obj.entity,
          originalTrackId: uniqueTrackId,
          objectHash,
          start,
          end,
          duration,
          confidence: avgConfidence,
          version,
          metadata: {
            entity: obj.entity,
            trackId: uniqueTrackId,
            originalTrackId: obj.trackId,
            frameCount: obj.frames.length,
          },
          // LabelEntityRef and LabelTrackRef will be set by step processor
        });
      }
    }

    this.logger.debug(
      `Normalized ${labelEntities.length} entities, ${labelTracks.length} tracks, ${labelObjects.length} objects`
    );

    return {
      labelEntities,
      labelTracks,
      labelClips: [], // Maintain interface compatibility but empty
      labelObjects,
      labelMediaUpdate: {}, // Writing only to specified entities
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
   * Generate object hash for deduplication
   *
   * Hash format: mediaId:trackId:version:processor
   *
   * @param mediaId Media ID
   * @param trackId Track ID from provider
   * @param version Version
   * @param processor Processor
   * @returns SHA-256 hash
   */
  private generateObjectHash(
    mediaId: string,
    trackId: string,
    version: number,
    processor: string
  ): string {
    const hashInput = `${mediaId}:${trackId}:${version}:${processor}`;
    return createHash('sha256').update(hashInput).digest('hex');
  }
}
