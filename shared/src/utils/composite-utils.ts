/**
 * Composite Clip Utilities
 *
 * Helper functions for handling composite clips that contain multiple
 * non-contiguous segments from a source media.
 */

import type { MediaClip } from '../schema/media-clip';

/**
 * Segment definition for composite clips
 */
export interface CompositeSegment {
  start: number; // Source media start time (seconds)
  end: number; // Source media end time (seconds)
}

/**
 * Result of expanding a composite clip into timeline segments
 */
export interface ExpandedSegment {
  /** Start time in the source media (seconds) */
  sourceStart: number;
  /** Duration of this segment (seconds) */
  duration: number;
  /** Start time on the timeline (seconds) */
  timelineStart: number;
}

/**
 * Check if a clip is a composite clip (has segments in clipData)
 *
 * @param clipType - The type field of the clip (e.g., 'composite')
 * @param clipData - The clipData field which may contain segments
 * @returns true if this is a composite clip with valid segments
 */
export function isCompositeClip(
  clipType?: string,
  clipData?: { segments?: CompositeSegment[] }
): boolean {
  return (
    clipType === 'composite' &&
    !!clipData?.segments &&
    Array.isArray(clipData.segments) &&
    clipData.segments.length > 0
  );
}

/**
 * Check if a MediaClip is a composite clip
 *
 * @param mediaClip - The MediaClip record to check
 * @returns true if this is a composite clip with valid segments
 */
export function isMediaClipComposite(mediaClip?: MediaClip | null): boolean {
  if (!mediaClip) return false;
  const clipData = mediaClip.clipData as { segments?: CompositeSegment[] };
  return isCompositeClip(mediaClip.type, clipData);
}

/**
 * Get segments from a MediaClip if it's a composite clip
 *
 * @param mediaClip - The MediaClip record
 * @returns Array of segments or undefined if not a composite clip
 */
export function getCompositeSegments(
  mediaClip?: MediaClip | null
): CompositeSegment[] | undefined {
  if (!isMediaClipComposite(mediaClip)) return undefined;
  const clipData = mediaClip!.clipData as { segments?: CompositeSegment[] };
  return clipData?.segments;
}

/**
 * Calculate the effective duration of a composite clip
 * This is the sum of all segment durations, not the full range
 *
 * @param start - Clip start time (fallback if no segments)
 * @param end - Clip end time (fallback if no segments)
 * @param segments - Optional array of segments
 * @returns Effective duration in seconds
 *
 * @example
 * // Segments: [1.8-6.7], [12.3-13.5], [14.8-17.1], [28.9-31.1]
 * // Effective: 4.9 + 1.2 + 2.3 + 2.2 = 10.6s
 * // NOT: 31.1 - 1.8 = 29.3s
 */
export function calculateEffectiveDuration(
  start: number,
  end: number,
  segments?: CompositeSegment[]
): number {
  if (!segments || segments.length === 0) {
    // Fallback to simple duration calculation
    return end - start;
  }

  return segments.reduce((total, seg) => {
    const segDuration = seg.end - seg.start;
    return total + Math.max(0, segDuration);
  }, 0);
}

/**
 * Calculate effective duration from a MediaClip
 *
 * @param mediaClip - The MediaClip record
 * @returns Effective duration in seconds
 */
export function calculateMediaClipEffectiveDuration(
  mediaClip: MediaClip
): number {
  const segments = getCompositeSegments(mediaClip);
  return calculateEffectiveDuration(mediaClip.start, mediaClip.end, segments);
}

/**
 * Build a "composite time" mapping from segments
 *
 * Composite time is a linear time scale where:
 * - 0 = start of first segment
 * - end of first segment maps to duration of first segment
 * - start of second segment maps immediately after first segment
 * - etc.
 *
 * This allows mapping from "composite time" (what the user sees) to
 * "source time" (actual position in the media file).
 *
 * @param segments - Array of segments
 * @returns Array of mapped segments with composite time ranges
 */
export interface CompositeTimeMapping {
  /** Start time in composite timeline (0-based) */
  compositeStart: number;
  /** End time in composite timeline */
  compositeEnd: number;
  /** Start time in source media */
  sourceStart: number;
  /** End time in source media */
  sourceEnd: number;
  /** Duration of this segment */
  duration: number;
}

export function buildCompositeTimeMapping(
  segments: CompositeSegment[]
): CompositeTimeMapping[] {
  const mapping: CompositeTimeMapping[] = [];
  let compositeTime = 0;

  // Sort by start time to ensure correct composite→source mapping
  const sorted = [...segments].sort((a, b) => a.start - b.start);

  for (const seg of sorted) {
    const duration = seg.end - seg.start;
    mapping.push({
      compositeStart: compositeTime,
      compositeEnd: compositeTime + duration,
      sourceStart: seg.start,
      sourceEnd: seg.end,
      duration,
    });
    compositeTime += duration;
  }

  return mapping;
}

/**
 * Expand composite segments into timeline segments
 *
 * Given a usage range in "composite time" and a timeline start position,
 * this function expands the composite segments into individual timeline segments
 * with proper source media timestamps.
 *
 * @param compositeSegments - The segments from the composite clip
 * @param usageSourceStart - Where in "composite time" this clip starts (default 0)
 * @param usageDuration - How much of the composite to use
 * @param timelineStart - Where on the timeline this clip starts
 * @returns Array of expanded segments for the timeline
 *
 * @example
 * // Composite segments: [1.8-6.7], [12.3-13.5], [14.8-17.1], [28.9-31.1]
 * // Usage: start at composite time 0, use full duration (10.6s)
 * // Timeline start: 0
 * // Result: 4 segments mapped to timeline positions 0, 4.9, 6.1, 8.4
 */
export function expandCompositeToSegments(
  compositeSegments: CompositeSegment[],
  usageSourceStart: number,
  usageDuration: number,
  timelineStart: number
): ExpandedSegment[] {
  const result: ExpandedSegment[] = [];
  const usageSourceEnd = usageSourceStart + usageDuration;

  // Build the composite time mapping
  const mapping = buildCompositeTimeMapping(compositeSegments);

  for (const mapped of mapping) {
    // Check if this segment intersects with the usage range
    const intersectStart = Math.max(usageSourceStart, mapped.compositeStart);
    const intersectEnd = Math.min(usageSourceEnd, mapped.compositeEnd);

    if (intersectEnd > intersectStart) {
      // This segment has content within the usage range
      const intersectionDuration = intersectEnd - intersectStart;

      // Calculate the offset into the real segment
      const offsetInRealSeg = intersectStart - mapped.compositeStart;
      const finalSourceStart = mapped.sourceStart + offsetInRealSeg;

      // Calculate timeline position
      const offsetInUsage = intersectStart - usageSourceStart;
      const finalTimelineStart = timelineStart + offsetInUsage;

      result.push({
        sourceStart: finalSourceStart,
        duration: intersectionDuration,
        timelineStart: finalTimelineStart,
      });
    }
  }

  return result;
}

/**
 * Calculate the total duration that would result from expanding composite segments
 * within a given usage range
 *
 * @param compositeSegments - The segments from the composite clip
 * @param usageSourceStart - Where in "composite time" this clip starts
 * @param usageDuration - How much of the composite to use
 * @returns Total duration after expansion
 */
export function calculateExpandedDuration(
  compositeSegments: CompositeSegment[],
  usageSourceStart: number,
  usageDuration: number
): number {
  const expanded = expandCompositeToSegments(
    compositeSegments,
    usageSourceStart,
    usageDuration,
    0 // Timeline start doesn't affect duration
  );

  return expanded.reduce((total, seg) => total + seg.duration, 0);
}
