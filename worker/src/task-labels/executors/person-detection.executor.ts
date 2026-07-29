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
  confidenceThreshold?: number; // default: 0.5 (see DEFAULT_CONFIDENCE_THRESHOLD)
  model?: string; // default: 'builtin/latest'
}

/**
 * Drop person tracks whose every frame scores below this.
 *
 * GCVI scores a person track far lower than a face track: a real response's
 * four tracked people came back at 0.77, 0.67, 0.55 and 0.52. A 0.7 cut —
 * fine for faces — therefore throws away most or all of the people in a
 * video, which is exactly what it did until this default was lowered. It also
 * matches the normalizer's own MIN_CLIP_CONFIDENCE, so the two stages agree on
 * what counts as a person.
 */
const DEFAULT_CONFIDENCE_THRESHOLD = 0.5;

/** GCVI attribute names for the two clothing slots, lowercased. */
const UPPER_CLOTH_ATTRIBUTES = new Set(['uppercloth', 'upper_clothing_color']);
const LOWER_CLOTH_ATTRIBUTES = new Set(['lowercloth', 'lower_clothing_color']);

/**
 * The color half of GCVI's clothing vocabulary. Every other value it reports
 * ("LongSleeve", "Jacket", "Plaid", …) is a garment or pattern descriptor, so
 * anything not listed here is treated as one — a new color the model starts
 * reporting shows up as a descriptor rather than being dropped.
 */
const CLOTHING_COLORS = new Set([
  'black',
  'blue',
  'brown',
  'gray',
  'grey',
  'green',
  'multicolor',
  'orange',
  'purple',
  'red',
  'white',
  'yellow',
]);

/** Config with every default resolved — the request and the response mapping
 * MUST read the same values, or we pay for data we then discard. */
interface ResolvedPersonDetectionConfig {
  includeBoundingBoxes: boolean;
  includePoseLandmarks: boolean;
  includeAttributes: boolean;
  confidenceThreshold: number;
}

export function resolvePersonDetectionConfig(
  config: PersonDetectionConfig = {}
): ResolvedPersonDetectionConfig {
  return {
    includeBoundingBoxes: config.includeBoundingBoxes ?? true,
    includePoseLandmarks: config.includePoseLandmarks ?? true,
    includeAttributes: config.includeAttributes ?? true,
    confidenceThreshold:
      config.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD,
  };
}

/**
 * The parts of an AnnotateVideo response the person mapping reads. Structural
 * rather than the generated proto types so a captured JSON response (the test
 * fixture) goes through the same mapping as a live one — the divergence
 * between a test-only mapper and this one is what hid the bugs above.
 */
interface RawDuration {
  seconds?: unknown;
  nanos?: unknown;
}

interface RawAttribute {
  name?: string | null;
  value?: string | null;
  confidence?: number | null;
}

interface RawLandmark {
  name?: string | null;
  point?: { x?: number | null; y?: number | null; z?: number | null } | null;
  confidence?: number | null;
}

interface RawTimestampedObject {
  timeOffset?: RawDuration | null;
  normalizedBoundingBox?: {
    left?: number | null;
    top?: number | null;
    right?: number | null;
    bottom?: number | null;
  } | null;
  attributes?: RawAttribute[] | null;
  landmarks?: RawLandmark[] | null;
}

interface RawTrack {
  trackId?: unknown;
  confidence?: number | null;
  timestampedObjects?: RawTimestampedObject[] | null;
}

export interface RawPersonDetectionResponse {
  annotationResults?:
    | Array<{
        personDetectionAnnotations?: Array<{
          tracks?: RawTrack[] | null;
        }> | null;
      }>
    | null
    | undefined;
}

/** Parse a Google Cloud time offset to seconds. */
function parseTimeOffset(timeOffset: RawDuration | null | undefined): number {
  if (!timeOffset) return 0;
  const seconds = parseInt(String(timeOffset.seconds ?? '0'), 10);
  const nanos = parseInt(String(timeOffset.nanos ?? '0'), 10);
  return seconds + nanos / 1000000000;
}

/**
 * The highest-confidence candidate among the attributes matching `names`,
 * restricted to colors or to descriptors. GCVI returns every candidate value
 * for an attribute, so taking the last one (or the first) picks an arbitrary
 * low-confidence guess.
 */
function topAttributeValue(
  attributes: RawAttribute[],
  names: ReadonlySet<string>,
  kind: 'color' | 'descriptor'
): string | undefined {
  let best: string | undefined;
  let bestConfidence = -1;

  for (const attribute of attributes) {
    const name = attribute.name?.toLowerCase() ?? '';
    const value = attribute.value ?? '';
    if (!value || !names.has(name)) continue;

    const isColor = CLOTHING_COLORS.has(value.toLowerCase());
    if (isColor !== (kind === 'color')) continue;

    const confidence = attribute.confidence ?? 0;
    if (confidence > bestConfidence) {
      bestConfidence = confidence;
      best = value;
    }
  }

  return best;
}

function mapAttributes(
  attributes: RawAttribute[] | null | undefined
): PersonAttributes | undefined {
  if (!attributes?.length) return undefined;

  const mapped: PersonAttributes = {
    upperClothingColor: topAttributeValue(
      attributes,
      UPPER_CLOTH_ATTRIBUTES,
      'color'
    ),
    upperClothingType: topAttributeValue(
      attributes,
      UPPER_CLOTH_ATTRIBUTES,
      'descriptor'
    ),
    lowerClothingColor: topAttributeValue(
      attributes,
      LOWER_CLOTH_ATTRIBUTES,
      'color'
    ),
    lowerClothingType: topAttributeValue(
      attributes,
      LOWER_CLOTH_ATTRIBUTES,
      'descriptor'
    ),
  };

  // Drop the undefined keys so an all-miss frame reports no attributes at all.
  for (const key of Object.keys(mapped) as Array<keyof PersonAttributes>) {
    if (mapped[key] === undefined) delete mapped[key];
  }

  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

function mapLandmarks(
  landmarks: RawLandmark[] | null | undefined
): PoseLandmark[] | undefined {
  if (!landmarks?.length) return undefined;

  return landmarks.map((landmark) => ({
    type: landmark.name ?? '',
    position: {
      x: landmark.point?.x ?? 0,
      y: landmark.point?.y ?? 0,
      // GCVI's v1 pose landmarks are 2D; z is carried for callers that get a
      // depth-bearing model.
      z: landmark.point?.z ?? 0,
    },
    confidence: landmark.confidence ?? 0,
  }));
}

/**
 * Map a raw AnnotateVideo response to the person response the normalizer
 * consumes. Pure, and the ONLY mapping — the executor and the fixture-driven
 * tests both go through it.
 *
 * One entry per track, not per annotation: GCVI nests tracks under each
 * personDetectionAnnotation, and taking only `tracks[0]` silently dropped
 * every person after the first in an annotation.
 */
export function mapPersonDetectionResponse(
  raw: RawPersonDetectionResponse,
  config: PersonDetectionConfig = {}
): PersonDetectionResponse {
  const resolved = resolvePersonDetectionConfig(config);
  const annotation = raw.annotationResults?.[0];

  const persons = (annotation?.personDetectionAnnotations ?? []).flatMap(
    (person) =>
      (person.tracks ?? []).map((track) => {
        // Empty when GCVI omits one — deliberately not the array index,
        // which would make this person's identity depend on their position
        // in the response. The normalizer derives a content-based id.
        const trackId =
          track.trackId !== undefined && track.trackId !== null
            ? String(track.trackId)
            : '';

        // GCVI scores the track, not the individual frames.
        const confidence = track.confidence ?? 0;

        const frames: PersonFrame[] = (track.timestampedObjects ?? []).map(
          (obj) => ({
            timeOffset: parseTimeOffset(obj.timeOffset),
            boundingBox: {
              left: obj.normalizedBoundingBox?.left ?? 0,
              top: obj.normalizedBoundingBox?.top ?? 0,
              right: obj.normalizedBoundingBox?.right ?? 0,
              bottom: obj.normalizedBoundingBox?.bottom ?? 0,
            },
            confidence,
            attributes: resolved.includeAttributes
              ? mapAttributes(obj.attributes)
              : undefined,
            landmarks: resolved.includePoseLandmarks
              ? mapLandmarks(obj.landmarks)
              : undefined,
          })
        );

        return { trackId, frames };
      })
  );

  return {
    persons: persons.filter((person) =>
      person.frames.some(
        (frame) => frame.confidence >= resolved.confidenceThreshold
      )
    ),
  };
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
    const resolved = resolvePersonDetectionConfig(config);

    try {
      // Build request
      const request = {
        inputUri: gcsUri,
        features: [
          protos.google.cloud.videointelligence.v1.Feature.PERSON_DETECTION,
        ],
        videoContext: {
          personDetectionConfig: {
            includeBoundingBoxes: resolved.includeBoundingBoxes,
            includePoseLandmarks: resolved.includePoseLandmarks,
            includeAttributes: resolved.includeAttributes,
          },
        },
      };

      this.logger.debug(
        `Person detection request: ${JSON.stringify({ gcsUri, ...resolved })}`
      );

      // Execute API call and await the operation with quota-aware polling
      const result =
        await this.googleCloudService.annotateVideoAndWait(request);

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

      const detected = (
        result.annotationResults[0].personDetectionAnnotations ?? []
      ).reduce((sum, person) => sum + (person.tracks?.length ?? 0), 0);
      const response = mapPersonDetectionResponse(result, resolved);

      this.logger.log(
        `Person detection completed: ${response.persons.length} persons tracked ` +
          `(${detected - response.persons.length} filtered below confidence ` +
          `${resolved.confidenceThreshold})`
      );

      return response;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Person detection failed: ${errorMessage}`);
      throw new Error(`Person detection execution failed: ${errorMessage}`);
    }
  }
}
