import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { LabelType, ProcessingProvider } from '@project/shared';
import type {
  PersonDetectionResponse,
  NormalizerInput,
  NormalizerOutput,
  LabelEntityData,
  LabelTrackData,
  LabelPersonData,
  LabelMediaData,
  KeyframeData,
} from '../types';

/**
 * Person Detection Normalizer
 *
 * Transforms GCVI Person Detection API responses into database entities:
 * - LabelEntity: Single "Person" entity
 * - LabelTrack: Tracked persons with keyframe data (bounding boxes, landmarks, attributes)
 * - LabelMedia: Aggregated person counts
 *
 * This normalizer handles:
 * - Person detection and tracking
 * - Keyframe extraction with bounding boxes
 * - Pose landmarks (body keypoints)
 * - Person attributes (clothing colors)
 */
interface AttributeSummary {
  upperClothingColor?: string;
  lowerClothingColor?: string;
}

interface LandmarkSummary {
  detectedTypes: string[];
  typeCounts: Record<string, number>;
  avgConfidences: Record<string, number>;
}

@Injectable()
export class PersonDetectionNormalizer {
  private readonly logger = new Logger(PersonDetectionNormalizer.name);

  // Configuration for clip filtering
  private readonly MIN_CLIP_DURATION = 0.5; // seconds
  private readonly MIN_CLIP_CONFIDENCE = 0.5;

  /**
   * Normalize person detection response into database entities
   *
   * @param input Normalizer input with response and context
   * @returns Normalized entities ready for database insertion
   */
  async normalize(
    input: NormalizerInput<PersonDetectionResponse>
  ): Promise<NormalizerOutput> {
    const {
      response,
      mediaId,
      workspaceRef,
      taskRef,
      version,
      processor,
      processorVersion,
    } = input;

    this.logger.debug(
      `Normalizing person detection response for media ${mediaId}: ${response.persons.length} persons`
    );

    const labelEntities: LabelEntityData[] = [];
    const labelTracks: LabelTrackData[] = [];
    const labelPeople: LabelPersonData[] = [];
    const seenLabels = new Set<string>();

    // Create single "Person" entity
    const entityHash = this.generateEntityHash(
      workspaceRef,
      LabelType.PERSON,
      'Person',
      ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE
    );

    if (!seenLabels.has(entityHash)) {
      labelEntities.push({
        WorkspaceRef: workspaceRef,
        labelType: LabelType.PERSON,
        canonicalName: 'Person',
        provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        processor: processorVersion,
        entityHash,
        metadata: {
          type: 'person_detection',
        },
      });
      seenLabels.add(entityHash);
    }

    // Process each tracked person
    for (const person of response.persons) {
      // Extract keyframes from frames with attributes and landmarks
      const keyframes: KeyframeData[] = person.frames.map((frame) => ({
        t: frame.timeOffset,
        bbox: {
          left: frame.boundingBox.left,
          top: frame.boundingBox.top,
          right: frame.boundingBox.right,
          bottom: frame.boundingBox.bottom,
        },
        confidence: frame.confidence,
        attributes: frame.attributes
          ? {
              upperClothingColor: frame.attributes.upperClothingColor,
              lowerClothingColor: frame.attributes.lowerClothingColor,
            }
          : undefined,
        landmarks: frame.landmarks
          ? frame.landmarks.map((landmark) => ({
              type: landmark.type,
              position: {
                x: landmark.position.x,
                y: landmark.position.y,
                z: landmark.position.z,
              },
              confidence: landmark.confidence,
            }))
          : undefined,
      }));

      // Calculate track start, end, and duration
      const start = person.frames[0]?.timeOffset ?? 0;
      const end = person.frames[person.frames.length - 1]?.timeOffset ?? 0;
      const duration = end - start;

      // Calculate average confidence
      const avgConfidence =
        person.frames.reduce((sum, frame) => sum + frame.confidence, 0) /
        person.frames.length;

      // Aggregate attributes and landmarks across frames
      const attributesSummary = this.aggregateAttributes(person.frames);
      const landmarksSummary = this.aggregateLandmarks(person.frames);

      // Generate track hash
      const trackHash = this.generateTrackHash(
        mediaId,
        person.trackId,
        version,
        processorVersion
      );

      // Create LabelTrack with keyframes, attributes, and landmarks
      labelTracks.push({
        WorkspaceRef: workspaceRef,
        MediaRef: mediaId,
        TaskRef: taskRef,
        trackId: person.trackId,
        start,
        end,
        duration,
        confidence: avgConfidence,
        provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        processor: processorVersion,
        version,
        trackData: {
          entity: 'Person',
          frameCount: person.frames.length,
          maxConfidence: Math.max(...person.frames.map((f) => f.confidence)),
          minConfidence: Math.min(...person.frames.map((f) => f.confidence)),
          attributes: attributesSummary,
          landmarks: landmarksSummary,
        },
        keyframes,
        trackHash,
        // LabelEntityRef will be set by step processor
      });

      // Create LabelPerson if track meets minimum criteria
      if (
        duration >= this.MIN_CLIP_DURATION &&
        avgConfidence >= this.MIN_CLIP_CONFIDENCE
      ) {
        const personHash = this.generatePersonHash(
          mediaId,
          person.trackId,
          version,
          processorVersion
        );

        labelPeople.push({
          WorkspaceRef: workspaceRef,
          MediaRef: mediaId,
          labelType: LabelType.PERSON,
          personId: person.trackId,
          personHash,
          start,
          end,
          duration,
          confidence: avgConfidence,
          upperBodyColor: attributesSummary.upperClothingColor as string,
          lowerBodyColor: attributesSummary.lowerClothingColor as string,
          hasLandmarks: landmarksSummary.detectedTypes.length > 0,
          metadata: {
            frameCount: person.frames.length,
            attributes: attributesSummary,
            landmarks: landmarksSummary,
          },
          version,
          // LabelEntityRef and LabelTrackRef will be set by step processor
        });
      }
    }

    // Create LabelMedia update with aggregated counts
    const labelMediaUpdate: Partial<LabelMediaData> = {
      personDetectionProcessedAt: new Date().toISOString(),
      personDetectionProcessor: processorVersion,
      personCount: labelPeople.length, // Count of significant person appearances
      personTrackCount: labelTracks.length, // Total number of person tracks
      // Add processor to processors array
      processors: ['person_detection'],
    };

    this.logger.debug(
      `Normalized ${labelEntities.length} entities, ${labelTracks.length} tracks, ${labelPeople.length} persons`
    );

    return {
      labelEntities,
      labelTracks,
      labelPeople,
      labelMediaUpdate,
    };
  }

  /**
   * Aggregate person attributes across all frames
   *
   * Returns the most common attribute values
   */
  private aggregateAttributes(
    frames: Array<{
      attributes?: { upperClothingColor?: string; lowerClothingColor?: string };
    }>
  ): AttributeSummary {
    const upperColorCounts = new Map<string, number>();
    const lowerColorCounts = new Map<string, number>();

    for (const frame of frames) {
      if (frame.attributes) {
        if (frame.attributes.upperClothingColor) {
          upperColorCounts.set(
            frame.attributes.upperClothingColor,
            (upperColorCounts.get(frame.attributes.upperClothingColor) ?? 0) + 1
          );
        }

        if (frame.attributes.lowerClothingColor) {
          lowerColorCounts.set(
            frame.attributes.lowerClothingColor,
            (lowerColorCounts.get(frame.attributes.lowerClothingColor) ?? 0) + 1
          );
        }
      }
    }

    // Find most common values
    const mostCommonUpperColor = this.getMostCommon(upperColorCounts);
    const mostCommonLowerColor = this.getMostCommon(lowerColorCounts);

    return {
      upperClothingColor: mostCommonUpperColor,
      lowerClothingColor: mostCommonLowerColor,
    };
  }

  /**
   * Aggregate pose landmarks across all frames
   *
   * Returns summary of detected landmark types and their frequency
   */
  private aggregateLandmarks(
    frames: Array<{
      landmarks?: Array<{
        type: string;
        position: { x: number; y: number; z: number };
        confidence: number;
      }>;
    }>
  ): LandmarkSummary {
    const landmarkTypeCounts = new Map<string, number>();
    const landmarkConfidences = new Map<string, number[]>();

    for (const frame of frames) {
      if (frame.landmarks) {
        for (const landmark of frame.landmarks) {
          // Count landmark types
          landmarkTypeCounts.set(
            landmark.type,
            (landmarkTypeCounts.get(landmark.type) ?? 0) + 1
          );

          // Collect confidences for averaging
          if (!landmarkConfidences.has(landmark.type)) {
            landmarkConfidences.set(landmark.type, []);
          }
          landmarkConfidences.get(landmark.type)!.push(landmark.confidence);
        }
      }
    }

    // Calculate average confidences
    const avgConfidences: Record<string, number> = {};
    for (const [type, confidences] of landmarkConfidences.entries()) {
      avgConfidences[type] =
        confidences.reduce((sum, c) => sum + c, 0) / confidences.length;
    }

    return {
      detectedTypes: Array.from(landmarkTypeCounts.keys()),
      typeCounts: Object.fromEntries(landmarkTypeCounts),
      avgConfidences,
    };
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
   * Generate person hash for deduplication
   *
   * Hash format: mediaId:personId:version:processor
   * This ensures unique person records per media and tracking run
   *
   * @param mediaId Media ID
   * @param personId Person/Track ID from provider
   * @param version Logic version
   * @param processor Processor identifier
   * @returns SHA-256 hash
   */
  private generatePersonHash(
    mediaId: string,
    personId: string,
    version: number,
    processor: string
  ): string {
    const hashInput = `${mediaId}:${personId}:${version}:${processor}`;
    return createHash('sha256').update(hashInput).digest('hex');
  }
}
