/**
 * Pure merge helpers that fold PocketBase realtime (SSE) events into the
 * cached `TimelineWithClips` the editor renders from.
 *
 * Contract — relied on to prevent re-render churn and render loops:
 *
 * - Every function returns the SAME reference when the event is a no-op
 *   (echo of a write the UI already applied, stale out-of-order event,
 *   wrong timeline), so TanStack Query's structural sharing skips observer
 *   notifications entirely.
 * - A cached record is only replaced when the incoming `updated` stamp is
 *   strictly newer. The SSE echo of our own write compares equal (the UI
 *   stores the server response, which carries the same stamp) and is
 *   dropped; late events older than the cache never regress it.
 * - After a clip change applies, the same in-memory reflow heal that
 *   `TimelineService.getTimeline` runs at load re-plans nested-timeline
 *   drift, so realtime merges never bypass the editor's healed view.
 */
import {
  planTimelineTreeReflow,
  type Timeline,
  type TimelineClip,
  type TimelineTrackRecord,
} from '@project/shared';
import type { TimelineWithClips } from '@/services/timeline';

/** PocketBase realtime event actions. */
export type RealtimeAction = 'create' | 'update' | 'delete' | (string & {});

/**
 * True when the incoming record supersedes the cached one. PocketBase
 * `updated` stamps ("2026-07-18 10:00:00.123Z") compare correctly as
 * strings; equal stamps mean the cache already holds this write (an echo),
 * so only strictly-newer records apply. Missing stamps fail open — applying
 * an identical record is idempotent, just not reference-stable.
 */
export function isRecordNewer(
  incoming: { updated?: unknown },
  existing: { updated?: unknown }
): boolean {
  const a = String(incoming.updated ?? '');
  const b = String(existing.updated ?? '');
  if (!a || !b) return true;
  return a > b;
}

/**
 * Re-run the load-time nested-drift heal after a clip merge, against the
 * already-healed nested map in the cache. Idempotent on a clean tree.
 */
function healClips(
  timeline: TimelineWithClips,
  clips: TimelineClip[]
): Pick<TimelineWithClips, 'clips' | 'nestedTimelines'> {
  const result = planTimelineTreeReflow({
    rootTimelineId: timeline.id,
    clips,
    tracks: timeline.tracks ?? [],
    nestedTimelines: timeline.nestedTimelines ?? {},
  });
  if (!result.hasDrift) {
    return { clips, nestedTimelines: timeline.nestedTimelines };
  }
  return {
    clips: result.updatedClips,
    nestedTimelines: result.updatedNested,
  };
}

const byOrder = (a: TimelineClip, b: TimelineClip) => a.order - b.order;

/**
 * Fold a TimelineClips realtime event into the cached timeline. Handles
 * clips moving between timelines (an update whose TimelineRef no longer
 * matches is treated as a removal) and missed creates (an update for an
 * unknown clip inserts it).
 */
export function applyClipEvent(
  timeline: TimelineWithClips,
  action: RealtimeAction,
  record: TimelineClip
): TimelineWithClips {
  const clips = timeline.clips ?? [];
  const index = clips.findIndex((c) => c.id === record.id);

  let nextClips: TimelineClip[];
  if (action === 'delete' || record.TimelineRef !== timeline.id) {
    if (index < 0) return timeline;
    nextClips = clips.filter((c) => c.id !== record.id);
  } else if (index >= 0) {
    if (!isRecordNewer(record, clips[index])) return timeline;
    nextClips = clips.map((c) => (c.id === record.id ? record : c));
    if (record.order !== clips[index].order) {
      nextClips = [...nextClips].sort(byOrder);
    }
  } else {
    nextClips = [...clips, record].sort(byOrder);
  }

  return { ...timeline, ...healClips(timeline, nextClips) };
}

/**
 * Fold a TimelineTracks realtime event into the cached timeline. Cascaded
 * clip changes (track deletion deleting/moving clips) arrive as their own
 * TimelineClips events; this only maintains the track list.
 */
export function applyTrackEvent(
  timeline: TimelineWithClips,
  action: RealtimeAction,
  record: TimelineTrackRecord
): TimelineWithClips {
  const tracks = timeline.tracks ?? [];
  const index = tracks.findIndex((t) => t.id === record.id);

  let nextTracks: TimelineTrackRecord[];
  if (action === 'delete' || record.TimelineRef !== timeline.id) {
    if (index < 0) return timeline;
    nextTracks = tracks.filter((t) => t.id !== record.id);
  } else if (index >= 0) {
    if (!isRecordNewer(record, tracks[index])) return timeline;
    nextTracks = tracks.map((t) => (t.id === record.id ? record : t));
    if (record.layer !== tracks[index].layer) {
      nextTracks = [...nextTracks].sort((a, b) => a.layer - b.layer);
    }
  } else {
    nextTracks = [...tracks, record].sort((a, b) => a.layer - b.layer);
  }

  return { ...timeline, tracks: nextTracks };
}

/**
 * Fold a Timelines record update into the cached timeline (name,
 * orientation, duration, version, …). Composite fields (clips, tracks,
 * nested map) are always kept from the cache — they're maintained by their
 * own collection events. `preserveName` keeps the cached name when the user
 * has an unsaved local rename in flight, so a concurrent remote rename
 * can't clobber the text they're typing.
 */
export function applyTimelineEvent(
  timeline: TimelineWithClips,
  action: RealtimeAction,
  record: Timeline,
  opts?: { preserveName?: boolean }
): TimelineWithClips {
  // Deletion of the whole timeline can't be represented as a merge; the
  // subscriber surfaces it as an error instead.
  if (action !== 'update' && action !== 'create') return timeline;
  if (record.id !== timeline.id) return timeline;
  if (!isRecordNewer(record, timeline)) return timeline;

  return {
    ...timeline,
    ...record,
    name: opts?.preserveName ? timeline.name : record.name,
    clips: timeline.clips,
    tracks: timeline.tracks,
    nestedTimelines: timeline.nestedTimelines,
  };
}
