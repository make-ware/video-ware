import type { TimelineClip } from '../schema/timeline-clip.js';
import type { Timeline } from '../schema/timeline.js';
import type { TimelineTrackRecord } from '../schema/timeline-track.js';
import type { TypedPocketBase } from '../types.js';
import { MAX_NESTED_TIMELINE_DEPTH, MAX_PLAYBACK_CHANNELS } from '../enums.js';
import { TimelineMutator } from '../mutators/timeline.js';
import { TimelineClipMutator } from '../mutators/timeline-clip.js';
import { TimelineTrackMutator } from '../mutators/timeline-track.js';
import {
  buildPlaybackTracks,
  type PlacedClip,
  type PlaybackTrack,
} from './timeline-placement.js';

/**
 * Nested (precomposed) timeline support.
 *
 * A TimelineClip with a SourceTimelineRef plays another timeline as a single
 * clip: clip.start/clip.end trim the nested timeline's own time axis (like a
 * media clip trims source media) and timelineStart places it on the parent.
 * The nested timeline is never edited through the parent — only trimmed.
 */

/** Clips + tracks of a referenced timeline, keyed by timeline id. */
export interface NestedTimelineData {
  timeline?: Timeline;
  clips: TimelineClip[];
  tracks: TimelineTrackRecord[];
}

export type NestedTimelineMap = Record<string, NestedTimelineData>;

export function isNestedTimelineClip(clip: TimelineClip): boolean {
  return !!clip.SourceTimelineRef;
}

/** Unique ids of timelines referenced by nested-timeline clips. */
export function collectNestedTimelineIds(clips: TimelineClip[]): string[] {
  const ids = new Set<string>();
  for (const clip of clips) {
    if (clip.SourceTimelineRef) ids.add(clip.SourceTimelineRef);
  }
  return [...ids];
}

/**
 * Would inserting `childTimelineId` into `parentTimelineId` create a cycle?
 * Walks the child's nested references transitively through `nested` (which
 * must contain the child's own clips for the walk to see them).
 */
export function wouldCreateTimelineCycle(
  parentTimelineId: string,
  childTimelineId: string,
  nested: NestedTimelineMap
): boolean {
  if (parentTimelineId === childTimelineId) return true;
  const visited = new Set<string>();
  const queue = [childTimelineId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (id === parentTimelineId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    const data = nested[id];
    if (data) queue.push(...collectNestedTimelineIds(data.clips));
  }
  return false;
}

/**
 * Fetch clips + tracks for every timeline referenced by nested-timeline
 * clips, breadth-first through nested-in-nested references up to
 * MAX_NESTED_TIMELINE_DEPTH. `visited` seeds the ids to skip (pass the root
 * timeline id, so self-references never fetch).
 *
 * The single source of truth for the nested-tree walk — the webapp editor
 * (load/save/render) and the `vw timeline reflow`/`doctor` CLI both call it,
 * so both heal against an identically fetched tree (same cycle handling and
 * depth limit). A deleted or inaccessible source timeline is skipped: the
 * referencing clip stays but plays/renders as nothing, like missing media.
 */
export async function fetchNestedTimelineMap(
  pb: TypedPocketBase,
  clips: TimelineClip[],
  visited: Set<string>
): Promise<NestedTimelineMap> {
  const timelineMutator = new TimelineMutator(pb);
  const clipMutator = new TimelineClipMutator(pb);
  const trackMutator = new TimelineTrackMutator(pb);

  const map: NestedTimelineMap = {};
  let frontier = collectNestedTimelineIds(clips).filter(
    (id) => !visited.has(id)
  );

  for (
    let depth = 0;
    frontier.length > 0 && depth < MAX_NESTED_TIMELINE_DEPTH;
    depth++
  ) {
    frontier.forEach((id) => visited.add(id));
    const results = await Promise.all(
      frontier.map(async (id) => {
        try {
          const [timeline, nestedClips, nestedTracks] = await Promise.all([
            timelineMutator.getById(id),
            clipMutator.getByTimeline(id),
            trackMutator.getByTimeline(id),
          ]);
          if (!timeline) return null;
          return {
            id,
            data: { timeline, clips: nestedClips, tracks: nestedTracks.items },
          };
        } catch {
          return null;
        }
      })
    );

    const next: string[] = [];
    for (const result of results) {
      if (!result) continue;
      map[result.id] = result.data;
      next.push(
        ...collectNestedTimelineIds(result.data.clips).filter(
          (id) => !visited.has(id)
        )
      );
    }
    frontier = [...new Set(next)];
  }

  return map;
}

/**
 * A child-time window projected through a nested clip's trim into parent time.
 * `headTrim` is how much was cut off the window's head by the trim in-point —
 * callers advance source offsets (sourceStart / clip.start) by it.
 */
export interface ProjectedWindow {
  parentStart: number;
  parentEnd: number;
  headTrim: number;
}

/**
 * Project a window [childStart, childEnd) of the nested timeline's time axis
 * into parent-timeline time, through a nested clip trimmed to
 * [trimStart, trimEnd) and placed at clipGlobalStart. Returns null when the
 * window falls entirely outside the trim.
 */
export function projectChildWindow(
  clipGlobalStart: number,
  trimStart: number,
  trimEnd: number,
  childStart: number,
  childEnd: number
): ProjectedWindow | null {
  const visibleStart = Math.max(childStart, trimStart);
  const visibleEnd = Math.min(childEnd, trimEnd);
  if (visibleEnd <= visibleStart) return null;
  return {
    parentStart: clipGlobalStart + (visibleStart - trimStart),
    parentEnd: clipGlobalStart + (visibleEnd - trimStart),
    headTrim: visibleStart - childStart,
  };
}

/**
 * Duration of a nested timeline as seen by the parent editor: the furthest
 * end of any placed clip (matches computeTimelineDuration, but avoids the
 * import cycle by taking the already-fetched data).
 */
export function computeNestedTimelineDuration(
  data: NestedTimelineData
): number {
  let max = 0;
  for (const track of buildPlaybackTracks(data.clips, data.tracks)) {
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

/**
 * The preview player's channel plan: bounded media channels plus every
 * caption (own and nested, projected to parent time) for the overlay layer.
 */
export interface PlaybackChannelsResult {
  /** Media channels to drive, capped at maxChannels, sorted by layer. */
  channels: PlaybackTrack[];
  /** Channels needed for full playback (before the cap). */
  requiredChannels: number;
  /** Channels dropped because the budget was exceeded. */
  droppedChannelCount: number;
  /**
   * All caption clips (own + nested, in parent time), in track layer order
   * (bottom first) so overlays stack like the editor lanes.
   */
  captionClips: PlacedClip[];
}

interface FlattenedTimeline {
  channels: PlaybackTrack[];
  captions: PlacedClip[];
}

/** Project a placed clip through a nested clip's window; null if invisible. */
function projectPlacedClip(
  placed: PlacedClip,
  nestedClip: PlacedClip
): PlacedClip | null {
  const projected = projectChildWindow(
    nestedClip.globalStart,
    nestedClip.clip.start,
    nestedClip.clip.end,
    placed.globalStart,
    placed.globalEnd
  );
  if (!projected) return null;
  const visibleDuration = projected.parentEnd - projected.parentStart;
  const start = placed.clip.start + projected.headTrim;
  return {
    clip: {
      ...placed.clip,
      // Composite id keeps React keys unique when the same nested timeline
      // is inserted more than once.
      id: `${nestedClip.clip.id}:${placed.clip.id}`,
      start,
      end: start + visibleDuration,
      duration: visibleDuration,
      timelineStart: projected.parentStart,
    },
    globalStart: projected.parentStart,
    globalEnd: projected.parentEnd,
  };
}

/**
 * Flatten a timeline (and its nested timelines, recursively) into playback
 * channels and caption overlays, all in this timeline's own time axis.
 */
function flattenTimeline(
  clips: TimelineClip[],
  tracks: TimelineTrackRecord[],
  nested: NestedTimelineMap,
  depth: number,
  visited: Set<string>
): FlattenedTimeline {
  const channels: PlaybackTrack[] = [];
  const captions: PlacedClip[] = [];

  for (const track of buildPlaybackTracks(clips, tracks)) {
    if (track.mediaClips.length > 0) {
      channels.push({ ...track, timelineClips: [] });
    }
    captions.push(...track.captionClips);

    // Derived channels from nested clips on this track. Same-track clips
    // never overlap in time, so projections from different nested clips can
    // share a channel when the child-channel index and settings match —
    // inserting the same precomp twice costs its channels only once.
    const derivedByKey = new Map<string, PlaybackTrack>();

    for (const placedNested of track.timelineClips) {
      const childId = placedNested.clip.SourceTimelineRef;
      if (!childId) continue;
      const childData = nested[childId];
      if (
        !childData ||
        visited.has(childId) ||
        depth >= MAX_NESTED_TIMELINE_DEPTH
      ) {
        continue;
      }

      const child = flattenTimeline(
        childData.clips,
        childData.tracks,
        nested,
        depth + 1,
        new Set([...visited, childId])
      );

      const gain = placedNested.clip.meta?.gain ?? 1;

      child.channels.forEach((childChannel, channelIndex) => {
        const projectedClips = childChannel.mediaClips
          .map((p) => projectPlacedClip(p, placedNested))
          .filter((p): p is PlacedClip => p !== null);
        if (projectedClips.length === 0) return;

        const volume = childChannel.volume * track.volume * gain;
        const opacity = childChannel.opacity * track.opacity;
        const isMuted = childChannel.isMuted || track.isMuted;
        const key = `${channelIndex}:${volume}:${opacity}:${isMuted}`;

        const existing = derivedByKey.get(key);
        if (existing) {
          existing.mediaClips.push(...projectedClips);
        } else {
          derivedByKey.set(key, {
            trackId: `${track.trackId ?? 'orphan'}:nested-${channelIndex}:${key}`,
            // Slot between this track and the next; ordering only, the
            // fraction never collides with integer track layers.
            layer: track.layer + (channelIndex + 1) / 64,
            opacity,
            volume,
            isMuted,
            mediaClips: projectedClips,
            captionClips: [],
            timelineClips: [],
          });
        }
      });

      for (const caption of child.captions) {
        const projected = projectPlacedClip(caption, placedNested);
        if (projected) captions.push(projected);
      }
    }

    channels.push(
      ...[...derivedByKey.values()].sort((a, b) => a.layer - b.layer)
    );
  }

  for (const channel of channels) {
    channel.mediaClips.sort((a, b) => a.globalStart - b.globalStart);
  }

  return { channels, captions };
}

/**
 * Resolve a timeline (including nested-timeline clips) into the bounded set
 * of media playback channels the preview can drive, plus caption overlays.
 *
 * Best effort under the channel budget: the timeline's own tracks always
 * play (their count is capped at MAX_TIMELINE_TRACKS, below the budget);
 * nested-timeline channels fill the remaining budget bottom layer first.
 * `droppedChannelCount` reports what could not be played so the UI can warn.
 */
export function buildPlaybackChannels(args: {
  clips: TimelineClip[];
  tracks: TimelineTrackRecord[];
  nestedTimelines?: NestedTimelineMap;
  /** The timeline being played; guards against self-reference cycles. */
  rootTimelineId?: string;
  maxChannels?: number;
}): PlaybackChannelsResult {
  const maxChannels = args.maxChannels ?? MAX_PLAYBACK_CHANNELS;
  const visited = new Set<string>(
    args.rootTimelineId ? [args.rootTimelineId] : []
  );

  const { channels, captions } = flattenTimeline(
    args.clips,
    args.tracks,
    args.nestedTimelines ?? {},
    0,
    visited
  );

  // Own tracks (integer layers) take priority over nested (fractional)
  // channels; within each group keep bottom layers first.
  const base = channels.filter((c) => Number.isInteger(c.layer));
  const derived = channels
    .filter((c) => !Number.isInteger(c.layer))
    .sort((a, b) => a.layer - b.layer);

  const kept = [
    ...base,
    ...derived.slice(0, Math.max(0, maxChannels - base.length)),
  ]
    .slice(0, maxChannels)
    .sort((a, b) => a.layer - b.layer);

  return {
    channels: kept,
    requiredChannels: channels.length,
    droppedChannelCount: channels.length - kept.length,
    captionClips: captions,
  };
}
