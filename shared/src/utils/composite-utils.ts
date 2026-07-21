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
 * Whether an edit list actually governs playback. A list needs at least two
 * segments to describe a cut; a 0/1-segment list is equivalent to the clip's
 * plain [start, end] window, and writers collapse it away (see
 * finalizeSegments in segment-edits.ts), so it is never treated as active.
 *
 * Composite-ness is decided purely by this predicate — a clip's `type` is its
 * origin (user/shot/face/…) and is never consulted or changed by segment
 * editing.
 */
export function hasActiveEditList(
  segments?: CompositeSegment[] | null
): segments is CompositeSegment[] {
  return Array.isArray(segments) && segments.length >= 2;
}

/**
 * Check if a clip is a composite clip: its clipData carries an active edit
 * list (>= 2 segments). Independent of the clip's `type`.
 *
 * @param clipData - The clipData field which may contain segments
 * @returns true if this is a composite clip with an active edit list
 */
export function isCompositeClip(clipData?: {
  segments?: CompositeSegment[];
}): boolean {
  return hasActiveEditList(clipData?.segments);
}

/**
 * Check if a MediaClip is a composite clip (active edit list in clipData).
 * Accepts anything carrying a clipData field (expanded records included).
 *
 * @param mediaClip - The MediaClip record to check
 * @returns true if this is a composite clip with an active edit list
 */
export function isMediaClipComposite(
  mediaClip?: Pick<MediaClip, 'clipData'> | null
): boolean {
  if (!mediaClip) return false;
  return isCompositeClip(
    mediaClip.clipData as { segments?: CompositeSegment[] }
  );
}

/**
 * Get segments from a MediaClip if it's a composite clip
 *
 * @param mediaClip - The MediaClip record
 * @returns The active edit list (>= 2 segments) or undefined — a 0/1-segment
 *   list is not an edit list; the clip's [start, end] is its source of truth
 */
export function getCompositeSegments(
  mediaClip?: Pick<MediaClip, 'clipData'> | null
): CompositeSegment[] | undefined {
  if (!mediaClip) return undefined;
  const clipData = mediaClip.clipData as { segments?: CompositeSegment[] };
  return hasActiveEditList(clipData?.segments) ? clipData.segments : undefined;
}

/**
 * Sub-ms tolerance: window intersections shorter than this are float noise,
 * not content (times are stored on the ms grid).
 */
const WINDOW_EPSILON = 0.001;

/**
 * Intersect an edit list with a clip's [start, end] trim window — the
 * non-destructive interpretation of a composite clip's stored times: the
 * window truncates what plays without editing the list itself, so a trimmed
 * clip can always be expanded back out to its full edit list.
 *
 * Stale-data safety: a degenerate window (end <= start, e.g. unset 0/0
 * fields) or one that covers no segment content falls back to the full list
 * rather than silencing the clip — saves validate windows, so an empty
 * intersection here means inconsistent stored data, not editorial intent.
 */
export function windowCompositeSegments(
  segments: CompositeSegment[],
  start: number,
  end: number
): CompositeSegment[] {
  if (segments.length === 0) return segments;
  if (!(end > start)) return segments;
  const windowed = segments
    .map((seg) => ({
      start: Math.max(seg.start, start),
      end: Math.min(seg.end, end),
    }))
    .filter((seg) => seg.end - seg.start > WINDOW_EPSILON);
  return windowed.length > 0 ? windowed : segments;
}

/**
 * Calculate the effective duration of a composite clip
 * This is the sum of the segment durations inside the clip's [start, end]
 * trim window (see windowCompositeSegments), not the full range
 *
 * @param start - Clip start time (window over the segments; plain duration
 *   fallback if no segments)
 * @param end - Clip end time (window over the segments)
 * @param segments - Optional array of segments
 * @returns Effective duration in seconds
 *
 * @example
 * // Segments: [1.8-6.7], [12.3-13.5], [14.8-17.1], [28.9-31.1]
 * // Window 1.8–31.1 → effective: 4.9 + 1.2 + 2.3 + 2.2 = 10.6s
 * // NOT: 31.1 - 1.8 = 29.3s
 * // Window 1.8–13.5 → effective: 4.9 + 1.2 = 6.1s
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

  return windowCompositeSegments(segments, start, end).reduce((total, seg) => {
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
 * Map an offset in composite (effective/playback) time to the source-media
 * time it plays. Offsets in [segment i's composite range] map linearly into
 * that segment; offsets at a boundary map to the earlier segment's end;
 * offsets beyond the total effective length clamp to the last segment's end
 * (and negative offsets to the first segment's start).
 *
 * Used to convert effective-duration trims (e.g. dragging a composite clip's
 * resize handle by N timeline seconds) into source-time window edges.
 */
export function sourceTimeAtCompositeOffset(
  segments: CompositeSegment[],
  offset: number
): number {
  const mapping = buildCompositeTimeMapping(segments);
  if (mapping.length === 0) return offset;
  if (offset <= 0) return mapping[0].sourceStart;

  for (const mapped of mapping) {
    if (offset <= mapped.compositeEnd) {
      return mapped.sourceStart + (offset - mapped.compositeStart);
    }
  }
  return mapping[mapping.length - 1].sourceEnd;
}

/**
 * Inverse of {@link sourceTimeAtCompositeOffset}: map a source-media time to
 * its offset in composite (effective/playback) time. Times inside a segment
 * map linearly; times in a gap collapse to the boundary offset shared by the
 * surrounding segments; times outside the edit list clamp to 0 / the total
 * effective length.
 *
 * Used to express a composite clip's [start, end] trim window in effective
 * time — e.g. converting the window's edges into resize-handle positions.
 */
export function compositeOffsetAtSourceTime(
  segments: CompositeSegment[],
  sourceTime: number
): number {
  const mapping = buildCompositeTimeMapping(segments);
  if (mapping.length === 0) return sourceTime;
  if (sourceTime <= mapping[0].sourceStart) return 0;

  for (const mapped of mapping) {
    if (sourceTime <= mapped.sourceEnd) {
      // In a gap before this segment, the offset collapses to its start.
      return (
        mapped.compositeStart + Math.max(0, sourceTime - mapped.sourceStart)
      );
    }
  }
  return mapping[mapping.length - 1].compositeEnd;
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
