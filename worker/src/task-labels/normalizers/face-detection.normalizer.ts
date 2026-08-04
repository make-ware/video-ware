import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  labelEntityKey,
  unionBbox,
  LabelType,
  ProcessingProvider,
} from '@project/shared';
import { deriveInstanceId, uniqueInstanceId } from '../utils/instance-id';
import type {
  FaceDetectionResponse,
  FaceAttributes,
  NormalizerInput,
  NormalizerOutput,
  LabelEntityData,
  LabelFaceData,
  LabelTrackData,
  LabelMediaData,
  KeyframeData,
} from '../types';

/**
 * Face Detection Normalizer
 *
 * Transforms GCVI Face Detection API responses into database entities:
 * - LabelEntity: Single "Face" entity (or per-person if identity available)
 * - LabelFace: Specific face instance data
 * - LabelTrack: Tracked faces with keyframe data (bounding boxes and attributes)
 * - LabelMedia: Aggregated face counts
 *
 * This normalizer handles:
 * - Face detection and tracking
 * - Keyframe extraction with bounding boxes
 * - Face attributes (headwear, glasses, looking at camera)
 */
@Injectable()
export class FaceDetectionNormalizer {
  private readonly logger = new Logger(FaceDetectionNormalizer.name);

  // Configuration for clip filtering
  private readonly MIN_CLIP_DURATION = 0.5; // seconds
  private readonly MIN_CLIP_CONFIDENCE = 0.5;

  /**
   * Normalize face detection response into database entities
   *
   * @param input Normalizer input with response and context
   * @returns Normalized entities ready for database insertion
   */
  async normalize(
    input: NormalizerInput<FaceDetectionResponse>
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
      `Normalizing face detection response for media ${mediaId}: ${response.faces.length} faces`
    );

    const labelEntities: LabelEntityData[] = [];
    const labelFaces: LabelFaceData[] = [];
    const labelTracks: LabelTrackData[] = [];
    // Guards against a provider response listing the same detection twice.
    const seenInstanceIds = new Map<string, number>();
    // Process each tracked face
    for (const face of response.faces) {
      if (!face.frames || face.frames.length === 0) {
        this.logger.debug(`Skipping face with no frames for media ${mediaId}`);
        continue;
      }

      let trackId = face.trackId;

      // GCVI frequently omits the track id. Derive one from the detection's
      // own content rather than its slot in the response: this id is the
      // LabelEntity key, so anything positional would re-key every face — and
      // strand every "this face is Erik" tag — on the next re-detect.
      if (!trackId || trackId.trim().length === 0) {
        trackId = uniqueInstanceId(
          deriveInstanceId({ kind: 'face', frames: face.frames }),
          seenInstanceIds
        );
        this.logger.debug(
          `Generated deterministic trackId ${trackId} for face`
        );
      }

      // One LabelEntity per face track. The provider gives no identity, so
      // every face is named "Face" — which is exactly why this must be keyed
      // by track and not by name: three faces in one media are three people,
      // and each needs its own link point to be told apart.
      const entityHash = labelEntityKey({
        workspaceRef,
        mediaId,
        labelType: LabelType.FACE,
        instanceId: trackId,
        provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
      });

      labelEntities.push({
        WorkspaceRef: workspaceRef,
        MediaRef: mediaId,
        labelType: LabelType.FACE,
        canonicalName: 'Face',
        instanceId: trackId,
        provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        processor: processorVersion,
        entityHash,
        metadata: {
          type: 'face_detection',
        },
      });

      // Initialize aggregation variables
      const keyframes: KeyframeData[] = [];
      let totalConfidence = 0;
      let maxConfidence = -Infinity;
      let minConfidence = Infinity;

      const attributeCounts: Record<string, Map<string, number>> = {
        joyLikelihood: new Map(),
        sorrowLikelihood: new Map(),
        angerLikelihood: new Map(),
        surpriseLikelihood: new Map(),
        underExposedLikelihood: new Map(),
        blurredLikelihood: new Map(),
        headwearLikelihood: new Map(),
        lookingAtCameraLikelihood: new Map(),
      };

      // Single pass over frames to collect all necessary data
      for (const frame of face.frames) {
        // 1. Extract keyframe
        keyframes.push({
          t: frame.timeOffset,
          bbox: {
            left: frame.boundingBox.left,
            top: frame.boundingBox.top,
            right: frame.boundingBox.right,
            bottom: frame.boundingBox.bottom,
          },
          confidence: frame.confidence,
          attributes: frame.attributes ? { ...frame.attributes } : undefined,
        });

        // 2. Track confidence metrics
        totalConfidence += frame.confidence;
        if (frame.confidence > maxConfidence) {
          maxConfidence = frame.confidence;
        }
        if (frame.confidence < minConfidence) {
          minConfidence = frame.confidence;
        }

        // 3. Aggregate attributes
        if (frame.attributes) {
          for (const [key, value] of Object.entries(frame.attributes)) {
            const countMap = attributeCounts[key];
            if (countMap && value !== undefined && value !== null) {
              const valStr = String(value);
              countMap.set(valStr, (countMap.get(valStr) ?? 0) + 1);
            }
          }
        }
      }

      // Calculate final aggregated values
      const start = face.frames[0].timeOffset;
      const end = face.frames[face.frames.length - 1].timeOffset;
      const duration = end - start;
      const avgConfidence = totalConfidence / face.frames.length;

      // Summarize attributes by finding the most common values
      const attributesSummary: Record<string, unknown> = {};
      for (const key of Object.keys(attributeCounts)) {
        attributesSummary[key] = this.getMostCommon(attributeCounts[key]);
      }

      // Build one standalone, typed FaceAttributes object per face from the
      // summary. `undefined` when the provider returned nothing usable, so the
      // metadata field can be safely omitted rather than stored empty.
      const faceAttributes = this.buildFaceAttributes(attributesSummary);

      // Generate track hash
      const trackHash = this.generateTrackHash(
        mediaId,
        trackId,
        version,
        processorVersion
      );

      // Create LabelFace
      const faceHash = this.generateFaceHash(
        mediaId,
        trackId,
        version,
        processorVersion
      );
      labelFaces.push({
        WorkspaceRef: workspaceRef,
        MediaRef: mediaId,
        labelType: LabelType.FACE,
        trackId: trackId,
        faceId: face.faceId,
        start: start,
        end: end,
        duration,
        avgConfidence,
        joyLikelihood: attributesSummary.joyLikelihood as string,
        sorrowLikelihood: attributesSummary.sorrowLikelihood as string,
        angerLikelihood: attributesSummary.angerLikelihood as string,
        surpriseLikelihood: attributesSummary.surpriseLikelihood as string,
        underExposedLikelihood:
          attributesSummary.underExposedLikelihood as string,
        blurredLikelihood: attributesSummary.blurredLikelihood as string,
        headwearLikelihood: attributesSummary.headwearLikelihood as string,
        lookingAtCameraLikelihood:
          attributesSummary.lookingAtCameraLikelihood as string,
        qualityScore: avgConfidence,
        embeddingModel: face.thumbnail
          ? 'google-video-intelligence'
          : undefined,
        visualHash: face.thumbnail
          ? createHash('sha256').update(face.thumbnail).digest('hex')
          : undefined,
        faceHash,
        metadata: {
          processorVersion,
          // Standalone, self-contained copy of the aggregated face attributes.
          // Optional by design — absent when the provider returned none.
          ...(faceAttributes ? { faceAttributes } : {}),
        },
      });

      // Create LabelTrack with keyframes and attributes
      labelTracks.push({
        WorkspaceRef: workspaceRef,
        MediaRef: mediaId,
        TaskRef: taskRef,
        trackId: trackId,
        start,
        end,
        duration,
        confidence: avgConfidence,
        provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        processor: processorVersion,
        version,
        trackData: {
          entity: 'Face',
          frameCount: face.frames.length,
          maxConfidence,
          minConfidence,
          attributes: attributesSummary,
        },
        keyframes,
        // The path's footprint, so spatial reads never open the keyframes blob.
        boundingBox: unionBbox(keyframes) ?? undefined,
        trackHash,
        labelType: LabelType.FACE,
        // LabelEntityRef will be set by step processor
      });
    }

    // Create LabelMedia update with aggregated counts
    const labelMediaUpdate: Partial<LabelMediaData> = {
      faceDetectionProcessedAt: new Date().toISOString(),
      faceDetectionProcessor: processorVersion,
      faceCount: labelFaces.length, // Count of significant face appearances
      faceTrackCount: labelTracks.length, // Total number of face tracks
      // Add processor to processors array
      processors: ['face_detection'],
    };

    // Validate and filter out invalid tracks and clips
    const validTracks = labelTracks.filter((track) =>
      this.isValidLabelTrack(track)
    );

    if (validTracks.length < labelTracks.length) {
      this.logger.warn(
        `Filtered out ${labelTracks.length - validTracks.length} invalid label tracks`
      );
    }

    // Update counts based on valid data
    labelMediaUpdate.faceCount = labelFaces.length;
    labelMediaUpdate.faceTrackCount = validTracks.length;

    this.logger.debug(
      `Normalized ${labelEntities.length} entities, ${validTracks.length} tracks, ${labelFaces.length} faces`
    );

    return {
      labelEntities,
      labelFaces,
      labelTracks: validTracks,
      labelMediaUpdate,
    };
  }

  /**
   * Build a standalone, typed FaceAttributes object from an aggregated
   * attribute summary.
   *
   * Only the known likelihood keys are copied, and only when they carry a
   * non-empty string — so a null/malformed summary never throws and never
   * leaks stray keys. Returns undefined when nothing usable is present, which
   * lets callers omit the field entirely.
   */
  private buildFaceAttributes(
    summary: Record<string, unknown>
  ): FaceAttributes | undefined {
    if (!summary || typeof summary !== 'object') {
      return undefined;
    }

    const keys: Array<keyof FaceAttributes> = [
      'joyLikelihood',
      'sorrowLikelihood',
      'angerLikelihood',
      'surpriseLikelihood',
      'underExposedLikelihood',
      'blurredLikelihood',
      'headwearLikelihood',
      'lookingAtCameraLikelihood',
    ];

    const attributes: FaceAttributes = {};
    for (const key of keys) {
      const value = summary[key];
      if (typeof value === 'string' && value.length > 0) {
        attributes[key] = value;
      }
    }

    return Object.keys(attributes).length > 0 ? attributes : undefined;
  }

  /**
   * Get the most common value from a count map
   */
  private getMostCommon(counts: Map<string, number>): string | undefined {
    let maxCount = 0;
    let mostCommon: string | undefined;

    for (const [value, count] of counts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = value;
      }
    }

    return mostCommon;
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
   * Generate face hash for deduplication
   */
  private generateFaceHash(
    mediaId: string,
    trackId: string,
    version: number,
    processor: string
  ): string {
    const hashInput = `${mediaId}:${trackId}:${version}:${processor}:face`;
    return createHash('sha256').update(hashInput).digest('hex');
  }

  /**
   * Generate clip hash for deduplication
   *
   * Hash format: mediaId:start:end:labelType
   * This ensures unique clips based on media, time range, and label type
   *
   * @param mediaId Media ID
   * @param start Start time
   * @param end End time
   * @param labelType Label type
   * @returns SHA-256 hash
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
   * Check if a label track is valid before insertion
   *
   * @param track The track to validate
   * @returns True if the track is valid
   */
  private isValidLabelTrack(track: LabelTrackData): boolean {
    // Check required fields
    if (!track.trackHash || track.trackHash.trim().length === 0) {
      return false;
    }
    if (!track.WorkspaceRef || track.WorkspaceRef.trim().length === 0) {
      return false;
    }
    if (!track.MediaRef || track.MediaRef.trim().length === 0) {
      return false;
    }
    if (!track.trackId || track.trackId.trim().length === 0) {
      return false;
    }

    // Check time values
    if (
      typeof track.start !== 'number' ||
      track.start < 0 ||
      !Number.isFinite(track.start)
    ) {
      return false;
    }
    if (
      typeof track.end !== 'number' ||
      track.end < 0 ||
      !Number.isFinite(track.end)
    ) {
      return false;
    }

    // End must be greater than start
    if (track.end <= track.start) {
      return false;
    }

    // Check duration (should be positive and match end - start)
    if (
      typeof track.duration !== 'number' ||
      track.duration < 0 ||
      !Number.isFinite(track.duration)
    ) {
      return false;
    }

    // Check confidence (must be between 0 and 1)
    if (
      typeof track.confidence !== 'number' ||
      track.confidence < 0 ||
      track.confidence > 1 ||
      !Number.isFinite(track.confidence)
    ) {
      return false;
    }

    // Check keyframes (must be an array)
    if (!Array.isArray(track.keyframes)) {
      return false;
    }

    // Validate each keyframe
    for (const keyframe of track.keyframes) {
      if (typeof keyframe !== 'object' || keyframe === null) {
        return false;
      }
      const kf = keyframe as {
        t?: number;
        bbox?: { left?: number; top?: number; right?: number; bottom?: number };
        confidence?: number;
      };
      if (typeof kf.t !== 'number' || kf.t < 0 || !Number.isFinite(kf.t)) {
        return false;
      }
      if (!kf.bbox || typeof kf.bbox !== 'object') {
        return false;
      }
      if (
        typeof kf.confidence !== 'number' ||
        kf.confidence < 0 ||
        kf.confidence > 1 ||
        !Number.isFinite(kf.confidence)
      ) {
        return false;
      }
    }

    return true;
  }
}
