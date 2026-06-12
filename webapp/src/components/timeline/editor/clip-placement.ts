import type { TimelineClip } from '@project/shared';

/**
 * Get clips on a track sorted by position (timelineStart or sequential order).
 * Matches the sort logic in track-lane.tsx.
 */
export function getSortedTrackClips(clips: TimelineClip[]): TimelineClip[] {
  return [...clips].sort((a, b) => {
    const aStart = a.timelineStart ?? 0;
    const bStart = b.timelineStart ?? 0;
    return aStart - bStart;
  });
}

/**
 * Compute effective [start, end] for each clip on the track.
 * Clips with timelineStart use it; others are placed sequentially after preceding clips.
 */
export function getClipRanges(
  trackClips: TimelineClip[]
): Array<{ start: number; end: number }> {
  const sorted = getSortedTrackClips(trackClips);
  const ranges: Array<{ start: number; end: number }> = [];
  let sequentialEnd = 0;

  for (const clip of sorted) {
    const duration = clip.end - clip.start;
    let start: number;

    if (clip.timelineStart !== undefined && clip.timelineStart !== null) {
      start = clip.timelineStart;
      sequentialEnd = Math.max(sequentialEnd, start + duration);
    } else {
      start = sequentialEnd;
      sequentialEnd = start + duration;
    }

    ranges.push({ start, end: start + duration });
  }

  return ranges;
}

/**
 * Find the first non-overlapping timelineStart for a new clip on a track.
 * Clips on the same track must not overlap.
 *
 * @param trackClips - Clips on the target track
 * @param desiredTime - Preferred placement time (e.g. after selected clip or end of track)
 * @param newClipDuration - Duration of the clip being placed
 * @param excludeClipId - Optional clip ID to exclude (e.g. when moving, exclude the clip being moved)
 * @returns The timelineStart that does not overlap any existing clips
 */
export function findNonOverlappingTimelineStart(
  trackClips: TimelineClip[],
  desiredTime: number,
  newClipDuration: number,
  excludeClipId?: string
): number {
  const sorted = getSortedTrackClips(trackClips);
  const ranges = getClipRanges(trackClips);
  const relevantRanges = sorted
    .map((clip, i) => ({ clip, range: ranges[i] }))
    .filter(({ clip }) => clip.id !== excludeClipId)
    .filter(({ range }) => range.end > range.start)
    .map(({ range }) => range)
    .sort((a, b) => a.start - b.start);

  if (relevantRanges.length === 0) {
    return Math.max(0, desiredTime);
  }

  let candidateTime = Math.max(0, desiredTime);

  for (const range of relevantRanges) {
    const newEnd = candidateTime + newClipDuration;
    const overlaps = candidateTime < range.end && newEnd > range.start;
    if (overlaps) {
      candidateTime = range.end;
    }
  }

  return candidateTime;
}

/**
 * A trim to apply to an existing clip so an inserted clip can take its place.
 * start/end are source-media times; timelineStart pins the clip at its
 * (possibly shifted) timeline position.
 */
export interface ClipTrim {
  clipId: string;
  start: number;
  end: number;
  timelineStart: number;
}

export interface OverwritePlan {
  trims: ClipTrim[];
  removals: string[];
}

const OVERLAP_EPSILON = 1e-6;

/**
 * Plan how existing clips on a track must be truncated so a new clip can be
 * inserted at insertStart (overwrite-style insert, e.g. at the playhead).
 *
 * - A clip overlapped at its tail keeps its head (out-point trimmed).
 * - A clip overlapped at its head keeps its tail (in-point trimmed and
 *   shifted to the end of the inserted clip).
 * - A clip fully covered by the insert range is removed.
 * - A clip spanning the whole insert range keeps only its head.
 */
export function planOverwriteAtTime(
  trackClips: TimelineClip[],
  insertStart: number,
  insertDuration: number
): OverwritePlan {
  const insertEnd = insertStart + insertDuration;
  const sorted = getSortedTrackClips(trackClips);
  const ranges = getClipRanges(trackClips);
  const trims: ClipTrim[] = [];
  const removals: string[] = [];

  sorted.forEach((clip, i) => {
    const { start: s, end: e } = ranges[i];
    if (e <= s) return;
    if (
      e <= insertStart + OVERLAP_EPSILON ||
      s >= insertEnd - OVERLAP_EPSILON
    ) {
      return;
    }

    const headDuration = insertStart - s; // portion surviving before the insert
    const tailDuration = e - insertEnd; // portion surviving after the insert

    if (headDuration > OVERLAP_EPSILON) {
      trims.push({
        clipId: clip.id,
        start: clip.start,
        end: clip.start + headDuration,
        timelineStart: s,
      });
    } else if (tailDuration > OVERLAP_EPSILON) {
      trims.push({
        clipId: clip.id,
        start: clip.end - tailDuration,
        end: clip.end,
        timelineStart: insertEnd,
      });
    } else {
      removals.push(clip.id);
    }
  });

  return { trims, removals };
}

/**
 * Compute the placement for a new clip: after the selected clip or at the end of the track.
 *
 * @param trackClips - Clips on the target track
 * @param selectedClipId - Currently selected clip (if any)
 * @param newClipDuration - Duration of the clip being added
 * @returns The timelineStart for the new clip
 */
export function computeClipPlacement(
  trackClips: TimelineClip[],
  selectedClipId: string | null,
  newClipDuration: number
): number {
  const ranges = getClipRanges(trackClips);
  const sorted = getSortedTrackClips(trackClips);

  let desiredTime = 0;

  if (selectedClipId && ranges.length > 0) {
    const selectedIndex = sorted.findIndex((c) => c.id === selectedClipId);
    if (selectedIndex >= 0) {
      desiredTime = ranges[selectedIndex].end;
    }
  }

  const endOfTrack =
    ranges.length > 0 ? Math.max(...ranges.map((r) => r.end)) : 0;
  desiredTime = Math.max(desiredTime, endOfTrack);

  return findNonOverlappingTimelineStart(
    trackClips,
    desiredTime,
    newClipDuration
  );
}
