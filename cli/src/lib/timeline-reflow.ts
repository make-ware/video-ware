import {
  TimelineClipMutator,
  TimelineMutator,
  TimelineTrackMutator,
  fetchNestedTimelineMap,
  planTimelineTreeReflow,
  type ClipReflowChange,
  type TimelineClip,
  type TimelineTrackRecord,
  type TypedPocketBase,
} from '@project/shared';
import { syncTimelineDuration } from './timeline.js';

/**
 * `timeline reflow`: heal drift between nested-timeline clips and their
 * source timelines' live durations (gap-preserving reflow), the same
 * planning the webapp runs on load/save/render. The webapp heals in memory
 * and persists only the saved timeline's own clips at save time; this
 * command is the explicit, user-invoked way to durably heal a whole tree
 * (nested timelines included). Also used by `timeline doctor` (dry-run) to
 * report pending drift. The nested tree is fetched via the shared
 * `fetchNestedTimelineMap`, so the CLI and webapp heal against the same walk.
 */

/** One timeline's pending changes within a reflow (root or nested). */
export interface TimelineReflowChanges {
  timelineId: string;
  changes: ClipReflowChange[];
}

export interface TimelineReflowPlans {
  /** Per-timeline changes, nested (deepest first) before the root. */
  plans: TimelineReflowChanges[];
  changeCount: number;
}

export interface ReflowTimelineResult extends TimelineReflowPlans {
  timelineId: string;
  /** False on dry runs and when nothing drifted. */
  applied: boolean;
}

/**
 * Plan a gap-preserving reflow from already-fetched root clips + tracks,
 * fetching only the nested tree the root doesn't already carry. Callers that
 * loaded the root elsewhere (e.g. `timeline doctor` via getTimelineOverview)
 * pass it straight through instead of re-fetching it.
 */
export async function planTimelineReflow(
  pb: TypedPocketBase,
  timelineId: string,
  clips: TimelineClip[],
  tracks: TimelineTrackRecord[]
): Promise<TimelineReflowPlans> {
  const nestedTimelines = await fetchNestedTimelineMap(
    pb,
    clips,
    new Set([timelineId])
  );

  const result = planTimelineTreeReflow({
    rootTimelineId: timelineId,
    clips,
    tracks,
    nestedTimelines,
  });

  const plans: TimelineReflowChanges[] = [
    ...Object.entries(result.nested).map(([id, plan]) => ({
      timelineId: id,
      changes: plan.changes,
    })),
    ...(result.root.changes.length > 0
      ? [{ timelineId, changes: result.root.changes }]
      : []),
  ];
  const changeCount = plans.reduce((sum, p) => sum + p.changes.length, 0);

  return { plans, changeCount };
}

/**
 * Plan (and unless `dryRun`, apply) a gap-preserving reflow of a timeline
 * and its nested timelines. Applying persists every change through the clip
 * mutator and re-syncs each touched timeline's stored duration.
 */
export async function reflowTimelineClips(
  pb: TypedPocketBase,
  timelineId: string,
  opts?: { dryRun?: boolean }
): Promise<ReflowTimelineResult> {
  const clipMutator = new TimelineClipMutator(pb);
  const trackMutator = new TimelineTrackMutator(pb);

  const timeline = await new TimelineMutator(pb).getById(timelineId);
  if (!timeline) {
    throw new Error(`Timeline not found: ${timelineId}`);
  }

  const clips = await clipMutator.getByTimeline(timelineId);
  const tracks = await trackMutator.getByTimeline(timelineId);

  const { plans, changeCount } = await planTimelineReflow(
    pb,
    timelineId,
    clips,
    tracks.items
  );

  if (opts?.dryRun || changeCount === 0) {
    return { timelineId, plans, changeCount, applied: false };
  }

  for (const plan of plans) {
    for (const { clipId, ...fields } of plan.changes) {
      await clipMutator.update(clipId, fields);
    }
    await syncTimelineDuration(pb, plan.timelineId);
  }

  return { timelineId, plans, changeCount, applied: true };
}
