import {
  MediaClipMutator,
  MediaMutator,
  TimelineClipMutator,
  TimelineTrackMutator,
  REFLOW_EPSILON,
  calculateEffectiveDuration,
  clampSegmentsToWindow,
  computeNestedTimelineDuration,
  deriveClipTimes,
  findNonOverlappingTimelineStart,
  getClipRanges,
  getCompositeSegments,
  getSortedTrackClips,
  planOverwriteAtTime,
  roundToMs,
  validateTimeRange,
  type Caption,
  type ClipTrim,
  type CompositeSegment,
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
  mediaBounds,
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
export function assertOnTimeline(
  clip: TimelineClip,
  timelineId?: string
): void {
  if (timelineId && clip.TimelineRef !== timelineId) {
    throw new Error(
      `Clip ${clip.id} belongs to timeline ${clip.TimelineRef}, not ${timelineId}.`
    );
  }
}

/** Where a timeline clip's current edit list comes from. */
export type TimelineEditListSource = 'meta' | 'mediaClip' | 'trim';

/**
 * Resolve the edit list a timeline clip renders with, mirroring the
 * generateSegmentsFromClip precedence: `meta.segments` override first, then
 * the referenced composite MediaClip's `clipData.segments`, else the clip's
 * own trim window (`'trim'` = not composite yet). Uses the mutator's default
 * MediaClipRef expansion when present, fetching only as a fallback.
 */
export async function resolveTimelineEditList(
  pb: TypedPocketBase,
  clip: TimelineClip
): Promise<{ segments: CompositeSegment[]; source: TimelineEditListSource }> {
  const metaSegments = clip.meta?.segments;
  if (metaSegments && metaSegments.length > 0) {
    return { segments: metaSegments, source: 'meta' };
  }
  if (clip.MediaClipRef) {
    const mediaClip =
      (clip as TimelineClipExpanded).expand?.MediaClipRef ??
      (await new MediaClipMutator(pb).getById(clip.MediaClipRef)) ??
      undefined;
    const segments = getCompositeSegments(mediaClip);
    if (segments && segments.length > 0) {
      return { segments, source: 'mediaClip' };
    }
  }
  return { segments: [{ start: clip.start, end: clip.end }], source: 'trim' };
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
 * media and recompute the stored duration (and the timeline's). On a clip
 * with an edit list (`meta.segments`, or a composite MediaClipRef) the
 * start/end window truncates what plays WITHOUT touching the edit list —
 * the render intersects the list with the window, and `duration` becomes
 * the windowed effective (gap-skipping) length. Non-destructive: a later
 * update can widen the window back out to the full edit list.
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

      const editList = await resolveTimelineEditList(pb, clip);
      if (editList.source !== 'trim') {
        // Validate the window covers content; the list itself stays intact
        // (windowing happens at render/duration time, so it's reversible).
        const windowed = clampSegmentsToWindow(
          editList.segments,
          start,
          end,
          mediaBounds(media)
        );
        if (windowed.length === 0) {
          throw new Error(
            `Trim window ${start}–${end}s contains no segment content — ` +
              `inspect the edit list with \`vw timeline clips segments ${clipId}\`.`
          );
        }
        // Clamp the window to the edit list's span so the stored times stay
        // meaningful (a wider window plays the full list anyway).
        const span = deriveClipTimes(editList.segments);
        patch.start = Math.max(start, span.start);
        patch.end = Math.min(end, span.end);
        patch.duration = calculateEffectiveDuration(
          patch.start,
          patch.end,
          editList.segments
        );
      } else {
        patch.start = start;
        patch.end = end;
        patch.duration = end - start;
      }
    } else if (clip.SourceTimelineRef) {
      // Nested-timeline clips trim against the source timeline's live
      // content duration (webapp updateClipTrim semantics).
      const [sourceClips, sourceTracks] = await Promise.all([
        clipMutator.getByTimeline(clip.SourceTimelineRef),
        new TimelineTrackMutator(pb).getByTimeline(clip.SourceTimelineRef),
      ]);
      const sourceDuration = computeNestedTimelineDuration({
        clips: sourceClips,
        tracks: sourceTracks.items,
      });
      if (
        !(start >= 0 && start < end) ||
        end > sourceDuration + REFLOW_EPSILON
      ) {
        throw new Error(
          `Invalid time range: start=${start}, end=${end}, ` +
            `timeline duration=${sourceDuration}`
        );
      }
      patch.start = start;
      patch.end = end;
      patch.duration = end - start;
      // A full-span window (untrim) follows the source's live duration from
      // here on; any narrower trim stops following. Either way the clip is
      // back in a user-chosen state, so an out-of-range clamp is cleared.
      const meta: NonNullable<TimelineClip['meta']> = { ...(clip.meta ?? {}) };
      meta.followSource =
        start <= REFLOW_EPSILON && end >= sourceDuration - REFLOW_EPSILON;
      delete meta.sourceOutOfRange;
      patch.meta = meta;
    } else if (!(start >= 0 && start < end)) {
      // caption clips have no source media; only ordering is enforced
      throw new Error(`Invalid time range: start=${start}, end=${end}`);
    } else {
      patch.start = start;
      patch.end = end;
      patch.duration = end - start;
    }
  }

  if (opts.gain !== undefined) {
    patch.meta = {
      ...(clip.meta ?? {}),
      ...(patch.meta ?? {}),
      gain: opts.gain,
    };
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

/** A lane clip zipped with its computed timeline range. */
export interface LaneEntry {
  clip: TimelineClip;
  range: { start: number; end: number };
}

/**
 * Resolve the track lane a clip lives on: the timeline's tracks (the
 * implicit layer-0 lane is materialized for legacy timelines), and the
 * lane's clips zipped with their computed timeline ranges in lane order.
 */
async function resolveClipLane(
  pb: TypedPocketBase,
  clip: TimelineClip
): Promise<{ track: TimelineTrackRecord; entries: LaneEntry[] }> {
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

  const allClips = await new TimelineClipMutator(pb).getByTimeline(timelineId);
  const laneClips = clipsOnTrack(allClips, trackList, track.id);
  const sorted = getSortedTrackClips(laneClips);
  const ranges = getClipRanges(laneClips);
  return {
    track,
    entries: sorted.map((c, i) => ({ clip: c, range: ranges[i] })),
  };
}

export interface DownstreamRippleResult {
  track: TimelineTrackRecord;
  /** Seconds actually shifted (leftward shifts clamp at `floor`). */
  by: number;
  requestedBy: number;
  shifted: RippleShift[];
}

/**
 * Shift only the clips *after* a clip on its lane by ±seconds, preserving
 * their spacing — the downstream half of a ripple edit, used when the
 * anchor clip's effective duration changed in place (segment cut/trim).
 * Leftward shifts clamp so the first downstream clip never crosses the
 * anchor's new render-effective end (`newEffectiveDuration` past its lane
 * position — its span end would no-op middle cuts). Every shifted clip is
 * written with an explicit timelineStart; the caller is responsible for
 * syncTimelineDuration.
 */
export async function rippleDownstreamClips(
  pb: TypedPocketBase,
  clip: TimelineClip,
  by: number,
  opts: { newEffectiveDuration: number; dryRun?: boolean }
): Promise<DownstreamRippleResult> {
  const { track, entries } = await resolveClipLane(pb, clip);
  const index = entries.findIndex((e) => e.clip.id === clip.id);
  const anchorStart = index >= 0 ? entries[index].range.start : 0;
  const anchorEnd = index >= 0 ? entries[index].range.end : 0;
  const downstream = entries.filter(
    (e) => e.clip.id !== clip.id && e.range.start >= anchorEnd
  );

  if (downstream.length === 0 || by === 0) {
    return { track, by: 0, requestedBy: by, shifted: [] };
  }

  const floor = Math.max(0, anchorStart + opts.newEffectiveDuration);
  const firstStart = Math.min(...downstream.map((e) => e.range.start));
  let applied = roundToMs(Math.max(by, floor - firstStart));
  // Clamping may only shrink the shift toward zero, never flip a leftward
  // ripple into a rightward one (e.g. downstream already overlaps the anchor).
  if (by < 0) applied = Math.min(0, applied);
  if (applied === 0) {
    return { track, by: 0, requestedBy: by, shifted: [] };
  }

  const shifted: RippleShift[] = downstream.map(({ clip: c, range }) => ({
    clipId: c.id,
    from: range.start,
    to: roundToMs(range.start + applied),
  }));

  if (!opts.dryRun) {
    const clipMutator = new TimelineClipMutator(pb);
    for (const shift of shifted) {
      await clipMutator.update(shift.clipId, { timelineStart: shift.to });
    }
  }

  return { track, by: applied, requestedBy: by, shifted };
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

  const { track, entries } = await resolveClipLane(pb, clip);
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
