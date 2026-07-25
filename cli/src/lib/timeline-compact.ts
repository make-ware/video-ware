import {
  TIMELINE_EPSILON,
  TimelineClipMutator,
  TimelineMutator,
  TimelineTrackMutator,
  getClipRanges,
  getSortedTrackClips,
  roundToMs,
  type TimelineClip,
  type TypedPocketBase,
} from '@project/shared';
import {
  clipsOnTrack,
  ensureDefaultTrack,
  resolveTrackRef,
  syncTimelineAfterWrite,
} from './timeline.js';
import {
  assertShiftTargetsUnchanged,
  partialShiftError,
  type RippleShift,
} from './timeline-clip.js';
import {
  noopNotice,
  postWriteOverlapWarning,
  type OpWarning,
} from './warnings.js';

/**
 * `vw timeline compact`: walk each track in lane order and re-place every
 * clip flush against the previous one — closing gaps (which render as black)
 * and resolving overlaps left behind by segment edits. Order is preserved,
 * never re-sequenced (fix play order first with `clips reorder`). Composite
 * clips occupy their effective duration, so a compacted layout is exactly
 * flush for them too. Idempotent: a second run is a no-op.
 *
 * Deliberately NOT a `reflow` mode — reflow's contract is gap-PRESERVING
 * (nested-drift healing only); compact's whole point is destroying gaps.
 */

export interface CompactTrackPlan {
  /** Null for the implicit lane of a legacy track-less timeline. */
  trackId: string | null;
  layer: number;
  moves: RippleShift[];
  /** Total positive gap closed on this lane (seconds). */
  closedGapSeconds: number;
}

export interface CompactTimelineResult {
  timelineId: string;
  /** Only lanes with at least one move. */
  tracks: CompactTrackPlan[];
  moveCount: number;
  /** False on dry runs and when nothing needed to move. */
  applied: boolean;
  dryRun: boolean;
  warnings: OpWarning[];
}

export interface CompactTimelineOptions {
  /** Restrict to one track (layer number or track id). */
  track?: string;
  /** Compute and report the plan without writing. */
  dryRun?: boolean;
}

export async function compactTimeline(
  pb: TypedPocketBase,
  timelineId: string,
  opts: CompactTimelineOptions = {}
): Promise<CompactTimelineResult> {
  const timeline = await new TimelineMutator(pb).getById(timelineId);
  if (!timeline) {
    throw new Error(`Timeline not found: ${timelineId}`);
  }
  const trackList = (
    await new TimelineTrackMutator(pb).getByTimeline(timelineId)
  ).items;
  if (trackList.length === 0) {
    // legacy timeline: materialize the implicit layer-0 lane
    trackList.push(await ensureDefaultTrack(pb, timelineId));
  }
  const clipMutator = new TimelineClipMutator(pb);
  const allClips = await clipMutator.getByTimeline(timelineId);

  const lanes = opts.track
    ? [await resolveTrackRef(pb, timelineId, opts.track)]
    : [...trackList].sort((a, b) => a.layer - b.layer);

  const tracks: CompactTrackPlan[] = [];
  const writes: Array<{
    clipId: string;
    to: number;
    trackRef?: string;
    snapshot: TimelineClip;
  }> = [];

  for (const track of lanes) {
    const laneClips = clipsOnTrack(allClips, trackList, track.id);
    const sorted = getSortedTrackClips(laneClips);
    const ranges = getClipRanges(laneClips);
    const moves: RippleShift[] = [];
    let closedGapSeconds = 0;
    let cursor = 0;
    let prevOriginalEnd = 0;

    sorted.forEach((clip, i) => {
      const range = ranges[i];
      const to = roundToMs(cursor);
      const duration = range.end - range.start;
      // Gap in the ORIGINAL layout (vs. the previous clip's original end).
      const gap = range.start - prevOriginalEnd;
      if (gap > TIMELINE_EPSILON) closedGapSeconds += gap;
      prevOriginalEnd = Math.max(prevOriginalEnd, range.end);

      // Same healing rule as `clips move`: a legacy clip missing its explicit
      // position or track pin gets one written even when it doesn't move.
      const needsPin =
        clip.timelineStart === undefined ||
        clip.timelineStart === null ||
        !clip.TimelineTrackRef;
      if (Math.abs(range.start - to) > TIMELINE_EPSILON || needsPin) {
        moves.push({ clipId: clip.id, from: range.start, to });
        writes.push({
          clipId: clip.id,
          to,
          ...(clip.TimelineTrackRef ? {} : { trackRef: track.id }),
          snapshot: clip,
        });
      }
      cursor = to + duration;
    });

    if (moves.length > 0) {
      tracks.push({
        trackId: track.id ?? null,
        layer: track.layer,
        moves,
        closedGapSeconds: roundToMs(closedGapSeconds),
      });
    }
  }

  const warnings: OpWarning[] = [];
  if (writes.length === 0) {
    return {
      timelineId,
      tracks: [],
      moveCount: 0,
      applied: false,
      dryRun: !!opts.dryRun,
      warnings: [
        noopNotice('every clip is already flush — nothing to write', []),
      ],
    };
  }
  if (opts.dryRun) {
    return {
      timelineId,
      tracks,
      moveCount: writes.length,
      applied: false,
      dryRun: true,
      warnings,
    };
  }

  // Bulk-shift safety (same contract as ripple): verify every planned record
  // is unchanged BEFORE the first write; escalate mid-loop conflicts so a
  // retry can never re-shift already-written clips.
  await assertShiftTargetsUnchanged(
    pb,
    timelineId,
    writes.map((w) => w.snapshot)
  );
  let written = 0;
  try {
    for (const write of writes) {
      await clipMutator.updateWithGuard(
        write.clipId,
        {
          timelineStart: write.to,
          ...(write.trackRef ? { TimelineTrackRef: write.trackRef } : {}),
        },
        { expectedUpdated: write.snapshot.updated, snapshot: write.snapshot }
      );
      written++;
    }
  } catch (err) {
    throw partialShiftError(err, written, writes.length, timelineId);
  }

  const check = await syncTimelineAfterWrite(
    pb,
    timelineId,
    writes.map((w) => w.clipId)
  );
  warnings.push(
    ...check.conflicts.map((f) => postWriteOverlapWarning(f, timelineId))
  );

  return {
    timelineId,
    tracks,
    moveCount: writes.length,
    applied: true,
    dryRun: false,
    warnings,
  };
}
