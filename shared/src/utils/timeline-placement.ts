import type { TimelineClip } from '../schema/timeline-clip.js';
import type { TimelineTrackRecord } from '../schema/timeline-track.js';

/**
 * Clip placement and playback resolution for timelines.
 *
 * Placement model: clips with a `timelineStart` sit at that absolute time on
 * the timeline; clips without one are appended sequentially after the
 * preceding clips on the same track. Clips on the same track must not
 * overlap. Shared by the webapp editor lanes/preview player and the CLI
 * insert/inspect commands.
 */

/**
 * Get clips on a track sorted by position (timelineStart or sequential order).
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
 * A shift to apply to a clip left behind by a ripple delete, pinning it at
 * its new (earlier) timeline position.
 */
export interface RippleDeleteMove {
  clipId: string;
  timelineStart: number;
}

/**
 * Plan how the remaining clips on a track move when clips are ripple
 * deleted: each remaining clip shifts left by the total duration of the
 * deleted clips positioned before it, closing the gaps they leave. Gaps that
 * already existed between clips are preserved, and clips before the deleted
 * clips are untouched.
 *
 * Moves pin clips via timelineStart (even previously sequential ones) so the
 * result is deterministic regardless of how each clip was placed.
 *
 * @param trackClips - Clips on the affected track (deleted ones included)
 * @param deletedClipIds - Clips being removed from this track
 * @returns timelineStart updates to apply after deleting the clips
 */
export function planRippleDelete(
  trackClips: TimelineClip[],
  deletedClipIds: string[]
): RippleDeleteMove[] {
  const deletedIds = new Set(deletedClipIds);
  const sorted = getSortedTrackClips(trackClips);
  const ranges = getClipRanges(trackClips);

  const deletedRanges = sorted
    .map((clip, i) => ({ clip, range: ranges[i] }))
    .filter(({ clip }) => deletedIds.has(clip.id))
    .map(({ range }) => range);

  const moves: RippleDeleteMove[] = [];

  sorted.forEach((clip, i) => {
    if (deletedIds.has(clip.id)) return;
    const { start } = ranges[i];
    // Clips on a track never overlap, so each deleted range is either
    // entirely before this clip (its length collapses) or after (no effect).
    const shift = deletedRanges
      .filter((r) => r.end <= start + OVERLAP_EPSILON)
      .reduce((sum, r) => sum + (r.end - r.start), 0);
    if (shift > OVERLAP_EPSILON) {
      moves.push({
        clipId: clip.id,
        timelineStart: Math.max(0, start - shift),
      });
    }
  });

  return moves;
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

/**
 * A clip resolved to its absolute position on the global timeline.
 * globalStart/globalEnd are timeline seconds; clip.start/clip.end remain
 * source-media seconds (the trim window).
 */
export interface PlacedClip {
  clip: TimelineClip;
  globalStart: number;
  globalEnd: number;
}

/**
 * A track resolved for playback: its settings plus the placed clips it owns,
 * split into media clips (played via a <video> element), caption clips
 * (rendered as overlays), and nested-timeline clips (expanded into extra
 * playback channels by buildPlaybackChannels).
 */
export interface PlaybackTrack {
  trackId: string | null;
  layer: number;
  opacity: number;
  volume: number;
  isMuted: boolean;
  mediaClips: PlacedClip[];
  captionClips: PlacedClip[];
  timelineClips: PlacedClip[];
}

/**
 * Resolve timeline clips into per-track placed clips for the preview player.
 *
 * Placement matches the editor lanes and the render path: clips with a
 * timelineStart sit at that absolute time; clips without one are appended
 * sequentially after the preceding clips on the same track. Clips with no
 * TimelineTrackRef fall back to the layer-0 (or first) track, mirroring the
 * default-track assignment used when adding clips.
 *
 * Tracks are returned sorted by layer ascending (0 = bottom).
 */
export function buildPlaybackTracks(
  clips: TimelineClip[],
  tracks: TimelineTrackRecord[]
): PlaybackTrack[] {
  const defaultTrack = tracks.find((t) => t.layer === 0) ?? tracks[0];

  const clipsByTrack = new Map<string | null, TimelineClip[]>();
  for (const clip of clips) {
    const trackId = clip.TimelineTrackRef ?? defaultTrack?.id ?? null;
    const trackClips = clipsByTrack.get(trackId) ?? [];
    trackClips.push(clip);
    clipsByTrack.set(trackId, trackClips);
  }

  const playbackTracks: PlaybackTrack[] = [];

  const buildTrack = (
    trackId: string | null,
    track: TimelineTrackRecord | undefined,
    trackClips: TimelineClip[]
  ): PlaybackTrack => {
    // getClipRanges operates on the sorted clip list; keep indexes aligned
    const sorted = getSortedTrackClips(trackClips);
    const ranges = getClipRanges(trackClips);

    const placed: PlacedClip[] = sorted.map((clip, i) => ({
      clip,
      globalStart: ranges[i].start,
      globalEnd: ranges[i].end,
    }));

    return {
      trackId,
      layer: track?.layer ?? 0,
      opacity: track?.opacity ?? 1,
      volume: track?.volume ?? 1,
      isMuted: track?.isMuted ?? false,
      mediaClips: placed.filter((p) => p.clip.MediaRef),
      captionClips: placed.filter((p) => p.clip.CaptionRef),
      timelineClips: placed.filter((p) => p.clip.SourceTimelineRef),
    };
  };

  for (const track of tracks) {
    playbackTracks.push(
      buildTrack(
        track.id ?? null,
        track,
        clipsByTrack.get(track.id ?? null) ?? []
      )
    );
  }

  // Legacy timelines with clips but no track records: synthesize a layer-0 track
  const orphanClips = clipsByTrack.get(null);
  if (orphanClips && orphanClips.length > 0) {
    playbackTracks.push(buildTrack(null, undefined, orphanClips));
  }

  return playbackTracks.sort((a, b) => a.layer - b.layer);
}

/**
 * Find the clip active at a given timeline time, if any.
 */
export function findActiveClip(
  placed: PlacedClip[],
  time: number
): PlacedClip | undefined {
  return placed.find((p) => time >= p.globalStart && time < p.globalEnd);
}

/**
 * Total timeline duration: the furthest end of any placed clip across all
 * tracks. (Summing clip durations is wrong once clips overlap across tracks
 * or use explicit timelineStart positions.)
 */
export function computeTimelineDuration(
  clips: TimelineClip[],
  tracks: TimelineTrackRecord[]
): number {
  let max = 0;
  for (const track of buildPlaybackTracks(clips, tracks)) {
    for (const placed of [
      ...track.mediaClips,
      ...track.captionClips,
      ...track.timelineClips,
    ]) {
      max = Math.max(max, placed.globalEnd);
    }
  }
  return max;
}
