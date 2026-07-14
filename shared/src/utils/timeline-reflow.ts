import type { TimelineClip } from '../schema/timeline-clip.js';
import type { TimelineTrackRecord } from '../schema/timeline-track.js';
import {
  getClipRanges,
  getClipTimelineDuration,
  getSortedTrackClips,
  groupClipsByTrack,
} from './timeline-placement.js';
import {
  collectNestedTimelineIds,
  computeNestedTimelineDuration,
  type NestedTimelineMap,
} from './nested-timeline.js';
import { roundToMs } from './segment-edits.js';

/**
 * Gap-preserving reflow for timelines with dynamic (nested-timeline) clips.
 *
 * A nested clip's start/end window the child timeline's time axis, but the
 * child keeps being edited after insert, so stored windows drift: a shrunken
 * child leaves windows past its end (render validation fails), a grown child
 * leaves follow-source clips stale-short. Reflow recomputes each nested
 * clip's live window and shifts each track's clips so the spacing between
 * them is preserved exactly (a 0s gap stays 0s, a 2s gap stays 2s, and a
 * pre-existing overlap stays that overlap — reflow heals drift, it never
 * repositions clips to resolve overlaps). Clips are never trimmed or removed
 * to resolve conflicts — they only move.
 *
 * Runs at natural touchpoints (editor load, save, render start, CLI reflow) —
 * never from background hooks — and is idempotent: planning again after the
 * plan is applied yields no changes.
 */

/** Drift below this is float noise, not a real edit (10ms). */
export const REFLOW_EPSILON = 1e-2;

/** Smallest window kept when clamping to a shrunk child (editor minimum). */
export const MIN_NESTED_WINDOW = 0.5;

/** Field updates healing one clip; only drifted fields are present. */
export interface ClipReflowChange {
  clipId: string;
  /** Absolute pin on the parent timeline (always explicit when emitted). */
  timelineStart?: number;
  /** New child-time window (nested clips only). */
  start?: number;
  end?: number;
  /** New stored effective duration. */
  duration?: number;
  /** Full replacement meta, merged from the clip's current meta. */
  meta?: TimelineClip['meta'];
}

export interface TimelineReflowPlan {
  changes: ClipReflowChange[];
}

export interface ReflowOptions {
  /**
   * Promote legacy full-span nested clips (no followSource flag, window
   * covering the whole live child) to follow-source. Default true.
   */
  promoteLegacyFullSpan?: boolean;
}

/** The reflowed geometry of one clip, before drift comparison. */
interface ClipTarget {
  clip: TimelineClip;
  /** Effective window; equals the stored window unless the clip drifted. */
  start: number;
  end: number;
  /** Effective on-timeline duration used for downstream placement. */
  duration: number;
  windowChanged: boolean;
  durationChanged: boolean;
  stampFollow: boolean;
  stampOutOfRange: boolean;
}

/**
 * Resolves a nested child's playback extent, or null when the child is
 * missing/unfetched. `computeNestedTimelineDuration` rebuilds the child's
 * playback tracks, so a parent referencing one child from many clips would
 * otherwise pay that cost per clip — see `makeExtentLookup` for the cache.
 */
type ExtentLookup = (childId: string) => number | null;

/**
 * Memoize `computeNestedTimelineDuration` by child id for one reflow pass.
 * `nested` is immutable within a single `planTimelineReflow` call, so the
 * cache is always consistent; a new lookup is created per call, so extents
 * healed between tree-reflow passes are never read stale.
 */
function makeExtentLookup(nested: NestedTimelineMap): ExtentLookup {
  const cache = new Map<string, number | null>();
  return (childId) => {
    const cached = cache.get(childId);
    if (cached !== undefined) return cached;
    const data = nested[childId];
    const extent = data ? computeNestedTimelineDuration(data) : null;
    cache.set(childId, extent);
    return extent;
  };
}

function resolveClipTarget(
  clip: TimelineClip,
  getExtent: ExtentLookup,
  promoteLegacyFullSpan: boolean
): ClipTarget {
  const unchanged: ClipTarget = {
    clip,
    start: clip.start,
    end: clip.end,
    duration: getClipTimelineDuration(clip),
    windowChanged: false,
    durationChanged: false,
    stampFollow: false,
    stampOutOfRange: false,
  };

  const childId = clip.SourceTimelineRef;
  if (!childId) return unchanged;

  const extent = getExtent(childId);
  // Deleted/unfetched child: leave untouched (validation reports it).
  if (extent === null) return unchanged;
  // Emptied child: nothing sensible to window; validation reports it.
  if (extent <= REFLOW_EPSILON) return unchanged;

  const follow =
    clip.meta?.followSource === true ||
    (promoteLegacyFullSpan &&
      clip.meta?.followSource === undefined &&
      clip.start <= REFLOW_EPSILON &&
      clip.end >= extent - REFLOW_EPSILON);

  let desiredStart = clip.start;
  let desiredEnd = clip.end;
  let stampOutOfRange = false;

  if (follow) {
    desiredStart = 0;
    desiredEnd = extent;
  } else if (clip.end > extent + REFLOW_EPSILON) {
    // Trimmed window sticking past the shrunk child.
    if (extent - clip.start >= MIN_NESTED_WINDOW - REFLOW_EPSILON) {
      // Tail clamp: keep the in-point, pull the out-point back.
      desiredEnd = extent;
    } else {
      // Window fell wholly (or almost) beyond the child: clamp to its tail
      // and flag it so the editor can surface the content change.
      desiredEnd = extent;
      desiredStart = Math.max(0, extent - Math.min(MIN_NESTED_WINDOW, extent));
      stampOutOfRange = clip.meta?.sourceOutOfRange !== true;
    }
  }

  const startChanged = Math.abs(desiredStart - clip.start) > REFLOW_EPSILON;
  const endChanged = Math.abs(desiredEnd - clip.end) > REFLOW_EPSILON;
  const start = startChanged ? roundToMs(desiredStart) : clip.start;
  const end = endChanged ? roundToMs(desiredEnd) : clip.end;
  const duration = roundToMs(end - start);

  return {
    clip,
    start,
    end,
    duration,
    windowChanged: startChanged || endChanged,
    durationChanged: Math.abs(duration - clip.duration) > REFLOW_EPSILON,
    stampFollow: follow && clip.meta?.followSource !== true,
    stampOutOfRange,
  };
}

function mergeMetaStamps(
  clip: TimelineClip,
  target: ClipTarget
): TimelineClip['meta'] | undefined {
  if (!target.stampFollow && !target.stampOutOfRange) return undefined;
  const meta: NonNullable<TimelineClip['meta']> = { ...clip.meta };
  if (target.stampFollow) meta.followSource = true;
  if (target.stampOutOfRange) meta.sourceOutOfRange = true;
  return meta;
}

function planTrackReflow(
  trackClips: TimelineClip[],
  getExtent: ExtentLookup,
  promoteLegacyFullSpan: boolean
): ClipReflowChange[] {
  const sorted = getSortedTrackClips(trackClips);
  const ranges = getClipRanges(trackClips);
  const targets = sorted.map((clip) =>
    resolveClipTarget(clip, getExtent, promoteLegacyFullSpan)
  );

  // Re-place preserving stored gaps: the first clip anchors at its stored
  // position; every following clip sits after the previous clip's reflowed
  // end at the stored gap. Gaps keep their sign — a pre-existing overlap
  // (negative gap) is preserved verbatim, so an undrifted track replans to
  // exactly its stored positions and overlaps are never "healed" as a side
  // effect (doctor reports them; resolving them is an editor decision).
  const positions: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0) {
      positions.push(ranges[0].start);
      continue;
    }
    const gap = ranges[i].start - ranges[i - 1].end;
    positions.push(
      Math.max(0, positions[i - 1] + targets[i - 1].duration + gap)
    );
  }

  // First index with geometry drift: from here on, every clip is pinned with
  // an explicit timelineStart (matching planRippleInsert/planRippleDelete —
  // deterministic regardless of how each clip was placed).
  let firstChanged = -1;
  for (let i = 0; i < sorted.length; i++) {
    const moved = Math.abs(positions[i] - ranges[i].start) > REFLOW_EPSILON;
    if (moved || targets[i].windowChanged || targets[i].durationChanged) {
      firstChanged = i;
      break;
    }
  }

  const changes: ClipReflowChange[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const target = targets[i];
    const meta = mergeMetaStamps(sorted[i], target);

    if (firstChanged === -1 || i < firstChanged) {
      // No geometry drift here — emit standalone meta stamps only.
      if (meta) changes.push({ clipId: sorted[i].id, meta });
      continue;
    }

    const change: ClipReflowChange = {
      clipId: sorted[i].id,
      timelineStart: roundToMs(positions[i]),
    };
    if (target.windowChanged) {
      change.start = target.start;
      change.end = target.end;
    }
    if (target.windowChanged || target.durationChanged) {
      change.duration = target.duration;
    }
    if (meta) change.meta = meta;
    changes.push(change);
  }

  return changes;
}

/**
 * Plan the reflow of one timeline against the live extents of its nested
 * children. Pure and idempotent; `nested` entries are read, never written.
 */
export function planTimelineReflow(
  clips: TimelineClip[],
  tracks: TimelineTrackRecord[],
  nested: NestedTimelineMap,
  options?: ReflowOptions
): TimelineReflowPlan {
  const promote = options?.promoteLegacyFullSpan ?? true;

  // Group clips into lanes exactly like buildPlaybackTracks (shared helper):
  // trackless clips fall back to the layer-0 track; a track-less legacy
  // timeline reflows as a single lane.
  const clipsByTrack = groupClipsByTrack(clips, tracks);

  // One extent cache for the whole pass: a child referenced from many clips
  // (or from several tracks) has its playback tracks rebuilt only once.
  const getExtent = makeExtentLookup(nested);

  const changes: ClipReflowChange[] = [];
  for (const trackClips of clipsByTrack.values()) {
    changes.push(...planTrackReflow(trackClips, getExtent, promote));
  }

  return { changes };
}

/** Apply a plan in memory, returning new clip objects for changed clips. */
export function applyReflowPlanToClips(
  clips: TimelineClip[],
  plan: TimelineReflowPlan
): TimelineClip[] {
  if (plan.changes.length === 0) return clips;
  const byId = new Map(plan.changes.map((c) => [c.clipId, c]));
  return clips.map((clip) => {
    const change = byId.get(clip.id);
    if (!change) return clip;
    return {
      ...clip,
      ...(change.timelineStart !== undefined && {
        timelineStart: change.timelineStart,
      }),
      ...(change.start !== undefined && { start: change.start }),
      ...(change.end !== undefined && { end: change.end }),
      ...(change.duration !== undefined && { duration: change.duration }),
      ...(change.meta !== undefined && { meta: change.meta }),
    };
  });
}

export interface TimelineTreeReflowResult {
  /** Plan for the root timeline's own clips. */
  root: TimelineReflowPlan;
  /** Plans for nested timelines that drifted, keyed by timeline id. */
  nested: Record<string, TimelineReflowPlan>;
  /** Root clips with the plan applied in memory. */
  updatedClips: TimelineClip[];
  /** Nested map with each child's plan applied in memory. */
  updatedNested: NestedTimelineMap;
  hasDrift: boolean;
}

/**
 * Reflow a fetched timeline tree bottom-up: children heal first (deepest
 * postorder), so each parent reflows against its children's healed extents.
 * Cycles are already broken by the nested-map construction; a visited set
 * guards defensively.
 */
export function planTimelineTreeReflow(args: {
  rootTimelineId: string;
  clips: TimelineClip[];
  tracks: TimelineTrackRecord[];
  nestedTimelines: NestedTimelineMap;
  options?: ReflowOptions;
}): TimelineTreeReflowResult {
  const { rootTimelineId, clips, tracks, nestedTimelines, options } = args;

  // Postorder over the nested tree (children before parents).
  const order: string[] = [];
  const visited = new Set<string>([rootTimelineId]);
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const data = nestedTimelines[id];
    if (!data) return;
    for (const childId of collectNestedTimelineIds(data.clips)) {
      visit(childId);
    }
    order.push(id);
  };
  for (const childId of collectNestedTimelineIds(clips)) visit(childId);
  // Defensive: heal any fetched entries not reachable from the root's clips.
  for (const id of Object.keys(nestedTimelines)) visit(id);

  const updatedNested: NestedTimelineMap = { ...nestedTimelines };
  const nestedPlans: Record<string, TimelineReflowPlan> = {};

  for (const id of order) {
    const data = updatedNested[id];
    if (!data) continue;
    const plan = planTimelineReflow(
      data.clips,
      data.tracks,
      updatedNested,
      options
    );
    if (plan.changes.length > 0) {
      nestedPlans[id] = plan;
      updatedNested[id] = {
        ...data,
        clips: applyReflowPlanToClips(data.clips, plan),
      };
    }
  }

  const root = planTimelineReflow(clips, tracks, updatedNested, options);
  const updatedClips = applyReflowPlanToClips(clips, root);

  return {
    root,
    nested: nestedPlans,
    updatedClips,
    updatedNested,
    hasDrift: root.changes.length > 0 || Object.keys(nestedPlans).length > 0,
  };
}
