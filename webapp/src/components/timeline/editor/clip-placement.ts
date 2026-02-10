import type { TimelineClip } from '@project/shared';

/**
 * Get clips on a track sorted by position (timelineStart or sequential order).
 * Matches the sort logic in track-lane.tsx.
 */
function getSortedTrackClips(clips: TimelineClip[]): TimelineClip[] {
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
function getClipRanges(
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
