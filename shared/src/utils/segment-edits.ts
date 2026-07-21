/**
 * Segment Edit Utilities
 *
 * Pure functions for safely editing a composite clip's edit list — the
 * ordered array of {start, end} source-time segments stored in
 * MediaClip.clipData.segments and TimelineClip.meta.segments. These back the
 * CLI's split/cut/trim/slip operations for fine-tuning dialogue.
 *
 * All times are source-media seconds. Every operation:
 *  - never mutates its input,
 *  - normalizes before applying (self-healing stored lists),
 *  - returns a normalized result (sorted, ms-rounded, clamped, overlap-free),
 *  - throws a plain Error with an actionable message on invalid edits.
 *
 * Segment indices in this module always refer to the sorted, normalized list.
 */

import type { CompositeSegment } from './composite-utils';

/**
 * Shortest segment an edit may create or keep. Matches the webapp segment
 * editor's per-segment minimum; normalize drops anything shorter (an
 * incidental sliver, e.g. left at a cut edge), while ops that would *create*
 * a shorter piece throw instead so the caller's intent isn't silently bent.
 */
export const MIN_SEGMENT_SECONDS = 0.1;

/**
 * Tolerance for treating two times as equal (1 ms — the rounding grid).
 * Gaps/overlaps within this are float noise, not editorial intent.
 */
export const SEGMENT_EPSILON = 0.001;

/**
 * Round to the millisecond grid the renderer uses (compose.executor's
 * fmtTime), so repeated edits can't accumulate float drift.
 */
export function roundToMs(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

/**
 * Media bounds for clamping/validation. `mediaDuration` of 0 or undefined
 * means "no upper bound" — the validateTimeRange convention for images and
 * legacy media without a known duration.
 */
export interface SegmentBounds {
  mediaDuration?: number;
}

/** True when the bounds impose an upper limit on segment ends. */
function hasUpperBound(bounds?: SegmentBounds): boolean {
  return typeof bounds?.mediaDuration === 'number' && bounds.mediaDuration > 0;
}

/** Format seconds for error messages (ms precision, no trailing zeros). */
function fmt(seconds: number): string {
  return `${roundToMs(seconds)}`;
}

/** Format a segment list for error messages, e.g. "1.8–6.7, 12.3–13.5". */
function fmtSegments(segments: CompositeSegment[]): string {
  return segments.map((s) => `${fmt(s.start)}–${fmt(s.end)}s`).join(', ');
}

/**
 * Normalize an edit list: round to ms, clamp to [0, mediaDuration], drop
 * segments shorter than MIN_SEGMENT_SECONDS, sort by start, merge genuine
 * overlaps (which would double-count duration), and snap sub-epsilon gaps to
 * exactly touching.
 *
 * Exactly-touching segments are deliberately KEPT separate: `split` creates
 * them on purpose so a boundary exists for subsequent trim/slip edits, and
 * they render identically to a merged segment. Only real overlaps merge.
 */
export function normalizeSegments(
  segments: CompositeSegment[],
  bounds?: SegmentBounds
): CompositeSegment[] {
  const upper = hasUpperBound(bounds) ? bounds!.mediaDuration! : undefined;

  const cleaned = segments
    .map((seg) => {
      let start = Math.max(0, roundToMs(seg.start));
      let end = roundToMs(seg.end);
      if (upper !== undefined) {
        start = Math.min(start, upper);
        end = Math.min(end, upper);
      }
      return { start, end };
    })
    .filter((seg) => seg.end - seg.start >= MIN_SEGMENT_SECONDS)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const result: CompositeSegment[] = [];
  for (const seg of cleaned) {
    const prev = result[result.length - 1];
    if (!prev) {
      result.push({ ...seg });
      continue;
    }
    if (seg.start < prev.end - SEGMENT_EPSILON) {
      // genuine overlap — merge so duration isn't double-counted
      prev.end = Math.max(prev.end, seg.end);
    } else if (seg.start <= prev.end + SEGMENT_EPSILON) {
      // touching (within float noise) — snap flush but keep the boundary
      const snapped = { start: prev.end, end: seg.end };
      if (snapped.end - snapped.start >= MIN_SEGMENT_SECONDS) {
        result.push(snapped);
      } else {
        prev.end = Math.max(prev.end, snapped.end);
      }
    } else {
      result.push({ ...seg });
    }
  }
  return result;
}

/**
 * Derive a clip's stored time fields from its edit list: `start`/`end` span
 * the segments (webapp clip-editor convention) and `duration` is the
 * effective (gap-skipping) playback length — the sum of segment lengths, NOT
 * `end - start`.
 */
export function deriveClipTimes(segments: CompositeSegment[]): {
  start: number;
  end: number;
  duration: number;
} {
  if (segments.length === 0) {
    throw new Error('Edit produced an empty segment list.');
  }
  const start = Math.min(...segments.map((s) => s.start));
  const end = Math.max(...segments.map((s) => s.end));
  const duration = roundToMs(
    segments.reduce((total, s) => total + Math.max(0, s.end - s.start), 0)
  );
  return { start, end, duration };
}

/** Result of {@link finalizeSegments}: what a writer should persist. */
export interface FinalizedSegments {
  /**
   * The edit list to persist, or undefined when it collapsed (< 2 segments)
   * and the clip's [start, end] becomes the source of truth again.
   */
  segments: CompositeSegment[] | undefined;
  start: number;
  end: number;
  /** Effective (gap-skipping) duration; equals end - start when collapsed. */
  duration: number;
}

/**
 * The storage invariant every edit-list writer routes through: a list with
 * fewer than 2 segments is not an edit list. Normalizes, then:
 *  - 0 segments: throws (an edit must leave content),
 *  - exactly 1: collapses — `segments` is undefined and `start`/`end` are
 *    that segment's bounds (the non-destructive auto-revert),
 *  - 2+: the normalized list with times from {@link deriveClipTimes}.
 */
export function finalizeSegments(
  segments: CompositeSegment[],
  bounds?: SegmentBounds
): FinalizedSegments {
  const normalized = normalizeSegments(segments, bounds);
  if (normalized.length === 0) {
    throw new Error('Edit produced an empty segment list.');
  }
  if (normalized.length === 1) {
    const [seg] = normalized;
    return {
      segments: undefined,
      start: seg.start,
      end: seg.end,
      duration: roundToMs(seg.end - seg.start),
    };
  }
  return { segments: normalized, ...deriveClipTimes(normalized) };
}

/**
 * Split segments at each source-time point. Each point must fall strictly
 * inside a segment with at least MIN_SEGMENT_SECONDS on both sides — a point
 * in a gap, outside the edit list, or hugging a boundary throws. Splitting
 * never changes effective duration; it creates boundaries for later edits.
 */
export function splitSegments(
  segments: CompositeSegment[],
  points: number[],
  bounds?: SegmentBounds
): CompositeSegment[] {
  if (points.length === 0) {
    throw new Error('Pass at least one split point.');
  }
  let result = normalizeSegments(segments, bounds);
  const sortedPoints = [...points].map(roundToMs).sort((a, b) => a - b);

  for (const point of sortedPoints) {
    const index = result.findIndex(
      (seg) =>
        point > seg.start + SEGMENT_EPSILON && point < seg.end - SEGMENT_EPSILON
    );
    if (index === -1) {
      throw new Error(
        `Split point ${fmt(point)}s is not inside any segment ` +
          `(segments: ${fmtSegments(result)}).`
      );
    }
    const seg = result[index];
    if (
      point - seg.start < MIN_SEGMENT_SECONDS ||
      seg.end - point < MIN_SEGMENT_SECONDS
    ) {
      throw new Error(
        `Split at ${fmt(point)}s would create a segment shorter than ` +
          `${MIN_SEGMENT_SECONDS}s (segment ${fmt(seg.start)}–${fmt(seg.end)}s).`
      );
    }
    result = [
      ...result.slice(0, index),
      { start: seg.start, end: point },
      { start: point, end: seg.end },
      ...result.slice(index + 1),
    ];
  }
  return result;
}

/**
 * Cut the source-time range [from, to] out of the edit list — the one-shot
 * "remove this umm" edit. An interior cut splits a segment in two; a spanning
 * cut deletes fully covered segments and trims partially covered ones.
 * Slivers shorter than MIN_SEGMENT_SECONDS left at the cut edges are dropped.
 * Throws when from >= to, when the range touches no segment content, or when
 * the cut would leave less than MIN_SEGMENT_SECONDS of total content.
 */
export function cutSegments(
  segments: CompositeSegment[],
  from: number,
  to: number,
  bounds?: SegmentBounds
): CompositeSegment[] {
  const cutStart = roundToMs(from);
  const cutEnd = roundToMs(to);
  if (!(cutStart < cutEnd)) {
    throw new Error(
      `Invalid cut range: --from ${fmt(cutStart)}s must be before --to ${fmt(cutEnd)}s.`
    );
  }
  const normalized = normalizeSegments(segments, bounds);

  const removed = normalized.reduce((total, seg) => {
    const overlap = Math.min(seg.end, cutEnd) - Math.max(seg.start, cutStart);
    return total + Math.max(0, overlap);
  }, 0);
  if (removed <= SEGMENT_EPSILON) {
    throw new Error(
      `Nothing to cut in ${fmt(cutStart)}–${fmt(cutEnd)}s ` +
        `(segments: ${fmtSegments(normalized)}).`
    );
  }

  const pieces: CompositeSegment[] = [];
  for (const seg of normalized) {
    if (
      seg.end <= cutStart + SEGMENT_EPSILON ||
      seg.start >= cutEnd - SEGMENT_EPSILON
    ) {
      pieces.push(seg);
      continue;
    }
    if (cutStart > seg.start) {
      pieces.push({ start: seg.start, end: Math.min(seg.end, cutStart) });
    }
    if (cutEnd < seg.end) {
      pieces.push({ start: Math.max(seg.start, cutEnd), end: seg.end });
    }
  }

  const result = normalizeSegments(pieces, bounds);
  if (result.length === 0) {
    throw new Error(
      `Cutting ${fmt(cutStart)}–${fmt(cutEnd)}s would remove all remaining content.`
    );
  }
  return result;
}

/**
 * Re-edge one segment of the edit list (`index` into the sorted, normalized
 * list — the order the `segments` command prints). Edges may extend into
 * gaps (restoring cut content) but must not cross neighboring segments,
 * exceed the media bounds, or shrink the segment below MIN_SEGMENT_SECONDS.
 */
export function trimSegment(
  segments: CompositeSegment[],
  index: number,
  patch: { start?: number; end?: number },
  bounds?: SegmentBounds
): CompositeSegment[] {
  if (patch.start === undefined && patch.end === undefined) {
    throw new Error('Pass a new --start and/or --end for the segment.');
  }
  const normalized = normalizeSegments(segments, bounds);
  if (!Number.isInteger(index) || index < 0 || index >= normalized.length) {
    throw new Error(
      `Segment index ${index} is out of range (0–${normalized.length - 1}).`
    );
  }

  const seg = normalized[index];
  let newStart = patch.start !== undefined ? roundToMs(patch.start) : seg.start;
  let newEnd = patch.end !== undefined ? roundToMs(patch.end) : seg.end;

  if (newStart < 0) {
    throw new Error(`Segment start ${fmt(newStart)}s cannot be negative.`);
  }
  if (
    hasUpperBound(bounds) &&
    newEnd > bounds!.mediaDuration! + SEGMENT_EPSILON
  ) {
    throw new Error(
      `Segment end ${fmt(newEnd)}s exceeds the media duration ` +
        `(${fmt(bounds!.mediaDuration!)}s).`
    );
  }

  const prev = normalized[index - 1];
  const next = normalized[index + 1];
  if (prev) {
    if (newStart < prev.end - SEGMENT_EPSILON) {
      throw new Error(
        `Segment start ${fmt(newStart)}s would cross the previous segment ` +
          `(ends at ${fmt(prev.end)}s).`
      );
    }
    if (newStart <= prev.end + SEGMENT_EPSILON) {
      newStart = prev.end; // snap flush
    }
  }
  if (next) {
    if (newEnd > next.start + SEGMENT_EPSILON) {
      throw new Error(
        `Segment end ${fmt(newEnd)}s would cross the next segment ` +
          `(starts at ${fmt(next.start)}s).`
      );
    }
    if (newEnd >= next.start - SEGMENT_EPSILON) {
      newEnd = next.start; // snap flush
    }
  }

  if (newEnd - newStart < MIN_SEGMENT_SECONDS) {
    throw new Error(
      `Trim would leave segment ${index} shorter than ${MIN_SEGMENT_SECONDS}s ` +
        `(${fmt(newStart)}–${fmt(newEnd)}s).`
    );
  }

  return [
    ...normalized.slice(0, index),
    { start: newStart, end: newEnd },
    ...normalized.slice(index + 1),
  ];
}

/**
 * Remove one segment from the edit list by index (into the sorted, normalized
 * list — the order the `segments` command prints). Equivalent to cutting that
 * segment's whole range, but with clearer intent and error messages. Throws
 * when the index is out of range or when it would remove the only remaining
 * segment — a clip must always keep at least one.
 */
export function deleteSegment(
  segments: CompositeSegment[],
  index: number,
  bounds?: SegmentBounds
): CompositeSegment[] {
  const normalized = normalizeSegments(segments, bounds);
  if (!Number.isInteger(index) || index < 0 || index >= normalized.length) {
    throw new Error(
      `Segment index ${index} is out of range (0–${normalized.length - 1}).`
    );
  }
  if (normalized.length === 1) {
    throw new Error(
      'Cannot delete the only remaining segment — a clip needs at least one.'
    );
  }
  return [...normalized.slice(0, index), ...normalized.slice(index + 1)];
}

/**
 * Slip the source window ±`by` seconds — same content length, different
 * source content — for the whole edit list or a single segment (`index`).
 * The delta is clamped against [0, mediaDuration] and, for a single-segment
 * slip, against the neighboring segments' edges. Returns the segments plus
 * the delta actually applied (0 = nothing could move).
 */
export function slipSegments(
  segments: CompositeSegment[],
  by: number,
  opts?: { index?: number } & SegmentBounds
): { segments: CompositeSegment[]; applied: number } {
  const normalized = normalizeSegments(segments, opts);
  if (normalized.length === 0) {
    throw new Error('Edit produced an empty segment list.');
  }
  const upper = hasUpperBound(opts) ? opts!.mediaDuration! : undefined;

  let targets: CompositeSegment[];
  let lowerFloor = 0;
  let upperCeil = upper;

  if (opts?.index !== undefined) {
    const index = opts.index;
    if (!Number.isInteger(index) || index < 0 || index >= normalized.length) {
      throw new Error(
        `Segment index ${index} is out of range (0–${normalized.length - 1}).`
      );
    }
    targets = [normalized[index]];
    const prev = normalized[index - 1];
    const next = normalized[index + 1];
    if (prev) lowerFloor = Math.max(lowerFloor, prev.end);
    if (next)
      upperCeil =
        upperCeil === undefined ? next.start : Math.min(upperCeil, next.start);
  } else {
    targets = normalized;
  }

  const minStart = Math.min(...targets.map((s) => s.start));
  const maxEnd = Math.max(...targets.map((s) => s.end));

  let applied = roundToMs(by);
  applied = Math.max(applied, lowerFloor - minStart);
  if (upperCeil !== undefined) {
    applied = Math.min(applied, upperCeil - maxEnd);
  }
  applied = roundToMs(applied);
  // A positive request can only clamp downward and vice versa — never let
  // clamping flip the direction of the slip.
  if (by > 0) applied = Math.max(0, applied);
  if (by < 0) applied = Math.min(0, applied);

  if (applied === 0) {
    return { segments: normalized, applied: 0 };
  }

  const shifted = normalized.map((seg) =>
    targets.includes(seg)
      ? {
          start: roundToMs(seg.start + applied),
          end: roundToMs(seg.end + applied),
        }
      : { ...seg }
  );
  return { segments: shifted, applied };
}

/**
 * Intersect the edit list with a whole-clip trim window [start, end] — the
 * segment-aware interpretation of `update --start/--end` on a composite.
 * May return an empty list (the window covers no segment content); callers
 * turn that into a domain error naming the clip.
 */
export function clampSegmentsToWindow(
  segments: CompositeSegment[],
  start: number,
  end: number,
  bounds?: SegmentBounds
): CompositeSegment[] {
  const windowStart = roundToMs(start);
  const windowEnd = roundToMs(end);
  if (!(windowStart < windowEnd)) {
    throw new Error(
      `Invalid time range: start=${fmt(windowStart)}, end=${fmt(windowEnd)}.`
    );
  }
  const pieces = normalizeSegments(segments, bounds)
    .map((seg) => ({
      start: Math.max(seg.start, windowStart),
      end: Math.min(seg.end, windowEnd),
    }))
    .filter((seg) => seg.end - seg.start > 0);
  return normalizeSegments(pieces, bounds);
}
