import {
  MediaMutator,
  TimelineClipMutator,
  TimelineTrackMutator,
  findNonOverlappingTimelineStart,
  getClipRanges,
  getSortedTrackClips,
  planOverwriteAtTime,
  validateTimeRange,
  type Caption,
  type ClipTrim,
  type MediaClip,
  type Timeline,
  type TimelineClip,
  type TimelineTrackRecord,
  type TypedPocketBase,
} from '@project/shared';
import { mediaLabel, type MediaWithUpload } from './select.js';
import {
  parseSeconds,
  parseUnitInterval,
  type OptionGroupOf,
} from './options.js';
import {
  clipsOnTrack,
  renumberClips,
  resolveTrackRef,
  singleMediaType,
  syncTimelineDuration,
} from './timeline.js';

/** Timeline-clip editing (update/move/remove/reorder) for the CLI. */

/** A timeline clip with the default TimelineClipMutator expansions. */
export type TimelineClipExpanded = TimelineClip & {
  expand?: {
    MediaRef?: MediaWithUpload;
    MediaClipRef?: MediaClip;
    CaptionRef?: Caption;
    SourceTimelineRef?: Timeline;
  };
};

/**
 * Human-readable clip name: TimelineClip label → source MediaClip label →
 * media upload name → 'Caption' → clip id (webapp getClipDisplayLabel
 * precedence).
 */
export function timelineClipLabelHint(clip: TimelineClipExpanded): string {
  if (clip.label) return clip.label;
  const mediaClipLabel = clip.expand?.MediaClipRef?.label;
  if (mediaClipLabel) return mediaClipLabel;
  const media = clip.expand?.MediaRef;
  if (media) return mediaLabel(media);
  if (clip.CaptionRef) return 'Caption';
  if (clip.SourceTimelineRef) {
    const source = clip.expand?.SourceTimelineRef;
    return source?.label || source?.name || 'Timeline';
  }
  return clip.id;
}

/** Error when a `-t <timelineId>` expectation doesn't match the clip. */
function assertOnTimeline(clip: TimelineClip, timelineId?: string): void {
  if (timelineId && clip.TimelineRef !== timelineId) {
    throw new Error(
      `Clip ${clip.id} belongs to timeline ${clip.TimelineRef}, not ${timelineId}.`
    );
  }
}

export interface UpdateTimelineClipOptions {
  /** Editor-facing clip name (searchable). */
  label?: string;
  /** Editor-facing clip notes (searchable). */
  description?: string;
  /** New trim start in source media (seconds). */
  start?: number;
  /** New trim end in source media (seconds). */
  end?: number;
  /** Per-clip audio gain multiplier (0..1); merged into meta. */
  gain?: number;
  /** Timeline the clip is expected to live on (validated when passed). */
  timelineId?: string;
}

/** `clips update` flags for the UpdateTimelineClipOptions fields. */
export const clipUpdateOptions = {
  label: {
    flags: '--label <text>',
    description: 'clip name shown in the editor (searchable)',
  },
  description: {
    flags: '--description <text>',
    description: 'clip notes shown in the editor (searchable)',
  },
  start: {
    flags: '-s, --start <seconds>',
    description: 'new trim start in source media',
    parse: parseSeconds,
  },
  end: {
    flags: '-e, --end <seconds>',
    description: 'new trim end in source media',
    parse: parseSeconds,
  },
  gain: {
    flags: '--gain <0-1>',
    description: 'per-clip audio gain multiplier',
    parse: parseUnitInterval,
  },
} satisfies OptionGroupOf<UpdateTimelineClipOptions>;

/**
 * Patch a timeline clip. Trim changes are re-validated against the source
 * media and recompute the stored duration (and the timeline's).
 */
export async function updateTimelineClip(
  pb: TypedPocketBase,
  clipId: string,
  opts: UpdateTimelineClipOptions
): Promise<TimelineClip> {
  const clipMutator = new TimelineClipMutator(pb);
  const clip = await clipMutator.getById(clipId);
  if (!clip) {
    throw new Error(`Timeline clip not found: ${clipId}`);
  }
  assertOnTimeline(clip, opts.timelineId);

  const patch: Partial<TimelineClip> = {
    ...(opts.label !== undefined ? { label: opts.label } : {}),
    ...(opts.description !== undefined
      ? { description: opts.description }
      : {}),
  };

  const trimChanged = opts.start !== undefined || opts.end !== undefined;
  if (trimChanged) {
    const start = opts.start ?? clip.start;
    const end = opts.end ?? clip.end;

    if (clip.MediaRef) {
      const media = await new MediaMutator(pb).getById(clip.MediaRef);
      if (!media) {
        throw new Error(
          `Clip ${clipId} references missing media ${clip.MediaRef}.`
        );
      }
      const mediaType = singleMediaType(media.mediaType);
      if (!validateTimeRange(start, end, media.duration, mediaType)) {
        throw new Error(
          `Invalid time range: start=${start}, end=${end}, media duration=${media.duration}`
        );
      }
    } else if (!(start >= 0 && start < end)) {
      // caption clips have no source media; only ordering is enforced
      throw new Error(`Invalid time range: start=${start}, end=${end}`);
    }

    patch.start = start;
    patch.end = end;
    patch.duration = end - start;
  }

  if (opts.gain !== undefined) {
    patch.meta = { ...(clip.meta ?? {}), gain: opts.gain };
  }

  if (Object.keys(patch).length === 0) {
    throw new Error('Nothing to update — pass at least one field flag.');
  }

  const updated = await clipMutator.update(clipId, patch);
  if (trimChanged) {
    await syncTimelineDuration(pb, clip.TimelineRef);
  }
  return updated;
}

export interface MoveTimelineClipOptions {
  /** Destination track: layer number or record id (default: current track). */
  track?: string;
  /** New timeline time (seconds). Default: keep the current computed position. */
  at?: number;
  /** With `at`: trim/remove overlapped clips instead of nudging forward. */
  overwrite?: boolean;
  /** Compute and report the placement without writing anything. */
  dryRun?: boolean;
  /** Timeline the clip is expected to live on (validated when passed). */
  timelineId?: string;
}

export interface MoveClipResult {
  /** The updated clip, or null on a dry run (nothing was written). */
  clip: TimelineClip | null;
  track: TimelineTrackRecord;
  /** Timeline time the clip landed at. */
  placedAt: number;
  placedEnd: number;
  requestedAt?: number;
  /** True when a collision nudged the clip past `requestedAt`. */
  nudged: boolean;
  /** Trims applied (or planned, on a dry run) to overwritten clips. */
  trims: ClipTrim[];
  trimmedClipIds: string[];
  removedClipIds: string[];
  dryRun: boolean;
}

/**
 * Move a clip to another track and/or timeline position. A bare `--track`
 * move keeps the clip's current computed position; collisions on the
 * destination nudge forward unless `overwrite`. Always writes an explicit
 * TimelineTrackRef and timelineStart (healing legacy unplaced clips).
 */
export async function moveTimelineClip(
  pb: TypedPocketBase,
  clipId: string,
  opts: MoveTimelineClipOptions
): Promise<MoveClipResult> {
  if (opts.overwrite && opts.at === undefined) {
    throw new Error('--overwrite requires --at <seconds>.');
  }
  if (!opts.track && opts.at === undefined) {
    throw new Error('Pass --track and/or --at.');
  }

  const clipMutator = new TimelineClipMutator(pb);
  const clip = await clipMutator.getById(clipId);
  if (!clip) {
    throw new Error(`Timeline clip not found: ${clipId}`);
  }
  assertOnTimeline(clip, opts.timelineId);
  const timelineId = clip.TimelineRef;

  const trackMutator = new TimelineTrackMutator(pb);
  const trackList = (await trackMutator.getByTimeline(timelineId)).items;
  if (trackList.length === 0) {
    // legacy timeline: materialize the implicit layer-0 lane
    trackList.push(
      await trackMutator.create({
        TimelineRef: timelineId,
        name: 'Main Track',
        layer: 0,
      })
    );
  }
  const currentTrack =
    trackList.find((t) => t.id === clip.TimelineTrackRef) ??
    trackList.find((t) => t.layer === 0) ??
    trackList[0];
  const destTrack = opts.track
    ? await resolveTrackRef(pb, timelineId, opts.track)
    : currentTrack;

  const allClips = await clipMutator.getByTimeline(timelineId);
  const duration = clip.end - clip.start;

  const patch: Partial<TimelineClip> = { TimelineTrackRef: destTrack.id };
  let placedAt: number;
  let nudged = false;
  const trims: ClipTrim[] = [];
  const trimmedClipIds: string[] = [];
  const removedClipIds: string[] = [];

  let targetAt = opts.at;
  if (targetAt === undefined) {
    // keep the clip's current computed position when only changing tracks
    const currentLane = clipsOnTrack(allClips, trackList, currentTrack.id);
    const sorted = getSortedTrackClips(currentLane);
    const ranges = getClipRanges(currentLane);
    const index = sorted.findIndex((c) => c.id === clipId);
    targetAt = index >= 0 ? ranges[index].start : (clip.timelineStart ?? 0);
  }
  const requestedAt = targetAt;

  const destClips = clipsOnTrack(allClips, trackList, destTrack.id);
  if (opts.overwrite) {
    const others = destClips.filter((c) => c.id !== clipId);
    const plan = planOverwriteAtTime(others, targetAt, duration);
    trims.push(...plan.trims);
    for (const trim of plan.trims) {
      if (!opts.dryRun) {
        await clipMutator.update(trim.clipId, {
          start: trim.start,
          end: trim.end,
          duration: trim.end - trim.start,
          timelineStart: trim.timelineStart,
        });
      }
      trimmedClipIds.push(trim.clipId);
    }
    for (const removeId of plan.removals) {
      if (!opts.dryRun) {
        await clipMutator.delete(removeId);
      }
      removedClipIds.push(removeId);
    }
    if (removedClipIds.length > 0 && !opts.dryRun) {
      const remaining = allClips.filter((c) => !removedClipIds.includes(c.id));
      await renumberClips(pb, timelineId, remaining);
    }
    placedAt = targetAt;
  } else {
    placedAt = findNonOverlappingTimelineStart(
      destClips,
      targetAt,
      duration,
      clipId
    );
    nudged = placedAt !== targetAt;
  }
  patch.timelineStart = placedAt;

  let updated: TimelineClip | null = null;
  if (!opts.dryRun) {
    updated = await clipMutator.update(clipId, patch);
    await syncTimelineDuration(pb, timelineId);
  }

  return {
    clip: updated,
    track: destTrack,
    placedAt,
    placedEnd: placedAt + duration,
    requestedAt,
    nudged,
    trims,
    trimmedClipIds,
    removedClipIds,
    dryRun: !!opts.dryRun,
  };
}

/** One clip's ripple displacement: its computed position before and after. */
export interface RippleShift {
  clipId: string;
  from: number;
  to: number;
}

export interface RippleClipsOptions {
  /** Seconds to shift the clip and everything after it (negative = left). */
  by: number;
  /** Compute and report the shifts without writing anything. */
  dryRun?: boolean;
  /** Timeline the clip is expected to live on (validated when passed). */
  timelineId?: string;
}

export interface RippleResult {
  track: TimelineTrackRecord;
  /** Seconds actually shifted (leftward shifts clamp at the previous clip). */
  by: number;
  /** Seconds that were requested. */
  requestedBy: number;
  shifted: RippleShift[];
  dryRun: boolean;
}

/**
 * Ripple edit: shift a clip and every clip after it on the same track by
 * ±seconds, preserving their relative spacing. Leftward shifts clamp so the
 * group can't cross the preceding clip or the start of the timeline. Every
 * shifted clip is written with an explicit timelineStart.
 */
export async function rippleTimelineClips(
  pb: TypedPocketBase,
  clipId: string,
  opts: RippleClipsOptions
): Promise<RippleResult> {
  if (!Number.isFinite(opts.by) || opts.by === 0) {
    throw new Error('Pass a non-zero --by <seconds> (negative shifts left).');
  }

  const clipMutator = new TimelineClipMutator(pb);
  const clip = await clipMutator.getById(clipId);
  if (!clip) {
    throw new Error(`Timeline clip not found: ${clipId}`);
  }
  assertOnTimeline(clip, opts.timelineId);
  const timelineId = clip.TimelineRef;

  const trackMutator = new TimelineTrackMutator(pb);
  const trackList = (await trackMutator.getByTimeline(timelineId)).items;
  if (trackList.length === 0) {
    // legacy timeline: materialize the implicit layer-0 lane
    trackList.push(
      await trackMutator.create({
        TimelineRef: timelineId,
        name: 'Main Track',
        layer: 0,
      })
    );
  }
  const track =
    trackList.find((t) => t.id === clip.TimelineTrackRef) ??
    trackList.find((t) => t.layer === 0) ??
    trackList[0];

  const allClips = await clipMutator.getByTimeline(timelineId);
  const laneClips = clipsOnTrack(allClips, trackList, track.id);
  const sorted = getSortedTrackClips(laneClips);
  const ranges = getClipRanges(laneClips);
  const entries = sorted.map((c, i) => ({ clip: c, range: ranges[i] }));

  const index = entries.findIndex((e) => e.clip.id === clipId);
  const anchorStart = entries[index].range.start;
  const group = entries.filter(
    (e, i) => i === index || e.range.start >= anchorStart
  );

  // Leftward shifts stop at the end of the closest clip before the group
  // (or 0): ripple moves clips, it never overlaps or trims them.
  const floor = Math.max(
    0,
    ...entries
      .filter((e) => !group.includes(e))
      .map((e) => Math.min(e.range.end, anchorStart))
  );
  const by = Math.max(opts.by, floor - anchorStart);

  const shifted: RippleShift[] = group.map(({ clip: c, range }) => ({
    clipId: c.id,
    from: range.start,
    to: range.start + by,
  }));

  if (!opts.dryRun && by !== 0) {
    for (const shift of shifted) {
      await clipMutator.update(shift.clipId, { timelineStart: shift.to });
    }
    await syncTimelineDuration(pb, timelineId);
  }

  return {
    track,
    by,
    requestedBy: opts.by,
    shifted: by === 0 ? [] : shifted,
    dryRun: !!opts.dryRun,
  };
}

export interface RemoveClipOptions {
  /** Shift later clips on the track left to close the gap (ripple delete). */
  ripple?: boolean;
  /** Timeline the clip is expected to live on (validated when passed). */
  timelineId?: string;
}

export interface RemoveClipResult {
  clip: TimelineClip;
  /** Downstream clips shifted left to close the gap (`ripple` only). */
  shifted: RippleShift[];
}

/**
 * Remove a clip, re-number the remaining clips densely (0..n-1), and re-sync
 * the timeline duration (webapp removeClipFromTimeline semantics). With
 * `ripple`, clips after the removed one on the same track shift left by the
 * removed clip's length, closing the gap.
 */
export async function removeTimelineClip(
  pb: TypedPocketBase,
  clipId: string,
  opts: RemoveClipOptions = {}
): Promise<RemoveClipResult> {
  const clipMutator = new TimelineClipMutator(pb);
  const clip = await clipMutator.getById(clipId);
  if (!clip) {
    throw new Error(`Timeline clip not found: ${clipId}`);
  }
  assertOnTimeline(clip, opts.timelineId);
  const timelineId = clip.TimelineRef;

  // Plan downstream shifts from the layout as it is now, before the delete.
  let shifted: RippleShift[] = [];
  if (opts.ripple) {
    const trackList = (
      await new TimelineTrackMutator(pb).getByTimeline(timelineId)
    ).items;
    const allClips = await clipMutator.getByTimeline(timelineId);
    const laneId = (
      trackList.find((t) => t.id === clip.TimelineTrackRef) ??
      trackList.find((t) => t.layer === 0) ??
      trackList[0]
    )?.id;
    const laneClips = laneId
      ? clipsOnTrack(allClips, trackList, laneId)
      : allClips; // legacy timeline without track records: one implicit lane
    const sorted = getSortedTrackClips(laneClips);
    const ranges = getClipRanges(laneClips);
    const index = sorted.findIndex((c) => c.id === clipId);
    if (index >= 0) {
      const removed = ranges[index];
      const gap = removed.end - removed.start;
      shifted = sorted
        .map((c, i) => ({ clip: c, range: ranges[i] }))
        .filter(
          ({ clip: c, range }) => c.id !== clipId && range.start >= removed.end
        )
        .map(({ clip: c, range }) => ({
          clipId: c.id,
          from: range.start,
          to: range.start - gap,
        }));
    }
  }

  await clipMutator.delete(clipId);
  for (const shift of shifted) {
    await clipMutator.update(shift.clipId, { timelineStart: shift.to });
  }
  const remaining = await clipMutator.getByTimeline(timelineId);
  await renumberClips(pb, timelineId, remaining);
  await syncTimelineDuration(pb, timelineId);
  return { clip, shifted };
}

/**
 * Replace a timeline's clip order with the given complete sequence. The id
 * list must contain every clip on the timeline exactly once.
 */
export async function reorderTimelineClips(
  pb: TypedPocketBase,
  timelineId: string,
  orderedIds: string[]
): Promise<TimelineClip[]> {
  const clipMutator = new TimelineClipMutator(pb);
  const clips = await clipMutator.getByTimeline(timelineId);

  const provided = new Set(orderedIds);
  if (provided.size !== orderedIds.length) {
    throw new Error('The new order lists a clip id more than once.');
  }
  const existing = new Set(clips.map((c) => c.id));
  const missing = clips.filter((c) => !provided.has(c.id)).map((c) => c.id);
  const extra = orderedIds.filter((id) => !existing.has(id));
  if (missing.length > 0 || extra.length > 0) {
    const parts = [
      'The new order must list every clip on the timeline exactly once.',
    ];
    if (missing.length > 0) parts.push(`Missing: ${missing.join(', ')}.`);
    if (extra.length > 0)
      parts.push(`Not on this timeline: ${extra.join(', ')}.`);
    throw new Error(parts.join(' '));
  }

  return clipMutator.reorderClips(
    timelineId,
    orderedIds.map((id, order) => ({ id, order }))
  );
}
