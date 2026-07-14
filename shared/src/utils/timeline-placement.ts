import type { TimelineClip } from '../schema/timeline-clip.js';
import type { TimelineTrackRecord } from '../schema/timeline-track.js';
import type { MediaClip } from '../schema/media-clip.js';
import {
  calculateEffectiveDuration,
  getCompositeSegments,
  sourceTimeAtCompositeOffset,
  windowCompositeSegments,
  type CompositeSegment,
} from './composite-utils.js';

/**
 * Clip placement and playback resolution for timelines.
 *
 * Placement model: clips with a `timelineStart` sit at that absolute time on
 * the timeline; clips without one are appended sequentially after the
 * preceding clips on the same track. Clips on the same track must not
 * overlap. Shared by the webapp editor lanes/preview player and the CLI
 * insert/inspect commands.
 *
 * Durations are always the clip's *effective* on-timeline length
 * (getClipTimelineDuration): composite clips occupy the gap-skipping sum of
 * their edit-list segments — the same length the render pipeline produces —
 * not their source-time span.
 */

/**
 * The edit list governing a clip's playback, if it is a composite:
 * TimelineClip.meta.segments (copy-on-write override) wins over the source
 * MediaClip's clipData.segments — mirroring the render pipeline's precedence
 * in generateSegmentsFromClip.
 */
export function getClipSegments(
  clip: TimelineClip
): CompositeSegment[] | undefined {
  if (clip.meta?.segments && clip.meta.segments.length > 0) {
    return clip.meta.segments;
  }
  const mediaClip = (
    clip as TimelineClip & { expand?: { MediaClipRef?: MediaClip } }
  ).expand?.MediaClipRef;
  return getCompositeSegments(mediaClip);
}

/**
 * The clip's effective duration on the timeline — the length it renders and
 * plays at. Composite clips skip their edit-list gaps, so this is the sum of
 * segment lengths; everything else (plain media, captions, nested timelines)
 * spans `end - start`.
 */
export function getClipTimelineDuration(clip: TimelineClip): number {
  // Nested-timeline clips trim the child's own time axis; their window is
  // already timeline-linear.
  if (clip.SourceTimelineRef) return clip.end - clip.start;
  return calculateEffectiveDuration(
    clip.start,
    clip.end,
    getClipSegments(clip)
  );
}

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
    const duration = getClipTimelineDuration(clip);
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
 * start/end are source-media times (for composites: the new window over the
 * edit list, which itself stays untouched); duration is the clip's new
 * effective on-timeline length; timelineStart pins the clip at its (possibly
 * shifted) timeline position.
 */
export interface ClipTrim {
  clipId: string;
  start: number;
  end: number;
  duration: number;
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

    // Composite clips are trimmed in effective (gap-skipping) time: the new
    // window edge is found by walking the windowed edit list, and the list
    // itself is never modified. Nested-timeline clips are timeline-linear.
    const segments = clip.SourceTimelineRef ? undefined : getClipSegments(clip);
    const windowed =
      segments && segments.length > 0
        ? windowCompositeSegments(segments, clip.start, clip.end)
        : undefined;

    if (headDuration > OVERLAP_EPSILON) {
      trims.push({
        clipId: clip.id,
        start: clip.start,
        end: windowed
          ? sourceTimeAtCompositeOffset(windowed, headDuration)
          : clip.start + headDuration,
        duration: headDuration,
        timelineStart: s,
      });
    } else if (tailDuration > OVERLAP_EPSILON) {
      trims.push({
        clipId: clip.id,
        start: windowed
          ? sourceTimeAtCompositeOffset(windowed, e - s - tailDuration)
          : clip.end - tailDuration,
        end: clip.end,
        duration: tailDuration,
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
 * Plan how existing clips on a track shift right so a range
 * [insertStart, insertStart + insertDuration) becomes free — the
 * non-destructive alternative to planOverwriteAtTime: no clip is ever
 * trimmed or removed, they all keep their full content and move instead.
 *
 * Every clip whose effective range ends after insertStart shifts right by a
 * single uniform delta, preserving the gaps between them:
 * - No clip straddles insertStart: the delta is exactly insertDuration.
 * - A clip straddles insertStart (e.g. inserting at a playhead mid-clip):
 *   the delta grows so that clip clears the inserted range entirely.
 *
 * Moves pin clips via timelineStart (even previously sequential ones) so the
 * result is deterministic regardless of how each clip was placed.
 *
 * @param trackClips - Clips on the target track
 * @param insertStart - Timeline time where the range begins
 * @param insertDuration - Length of the range to free up
 * @param excludeClipId - Clip to ignore (e.g. the clip being grown/moved)
 * @returns timelineStart updates to apply before/with the insert
 */
export function planRippleInsert(
  trackClips: TimelineClip[],
  insertStart: number,
  insertDuration: number,
  excludeClipId?: string
): RippleDeleteMove[] {
  if (insertDuration <= OVERLAP_EPSILON) return [];

  const sorted = getSortedTrackClips(trackClips);
  const ranges = getClipRanges(trackClips);

  const affected = sorted
    .map((clip, i) => ({ clip, range: ranges[i] }))
    .filter(({ clip }) => clip.id !== excludeClipId)
    .filter(({ range }) => range.end > range.start)
    .filter(({ range }) => range.end > insertStart + OVERLAP_EPSILON);

  if (affected.length === 0) return [];

  const firstStart = Math.min(...affected.map(({ range }) => range.start));
  const delta =
    firstStart < insertStart - OVERLAP_EPSILON
      ? insertStart + insertDuration - firstStart
      : insertDuration;

  return affected.map(({ clip, range }) => ({
    clipId: clip.id,
    timelineStart: range.start + delta,
  }));
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
 * Group clips by their owning track id, applying the fallbacks placement
 * relies on: a clip with no TimelineTrackRef is assigned to the layer-0 (or
 * first) track, and clips of a track-less legacy timeline collect under the
 * `null` key as a single synthesized lane. Shared by buildPlaybackTracks and
 * the reflow planner so both partition clips into lanes identically.
 */
export function groupClipsByTrack(
  clips: TimelineClip[],
  tracks: TimelineTrackRecord[]
): Map<string | null, TimelineClip[]> {
  const defaultTrack = tracks.find((t) => t.layer === 0) ?? tracks[0];
  const clipsByTrack = new Map<string | null, TimelineClip[]>();
  for (const clip of clips) {
    const trackId = clip.TimelineTrackRef ?? defaultTrack?.id ?? null;
    const trackClips = clipsByTrack.get(trackId) ?? [];
    trackClips.push(clip);
    clipsByTrack.set(trackId, trackClips);
  }
  return clipsByTrack;
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
  const clipsByTrack = groupClipsByTrack(clips, tracks);

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
