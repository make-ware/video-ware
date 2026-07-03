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
  type MediaClip,
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
  return clip.id;
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
  /** Clear the timelineStart pin so the clip re-flows sequentially by order. */
  sequential?: boolean;
}

export interface MoveClipResult {
  clip: TimelineClip;
  track: TimelineTrackRecord;
  /** Timeline time the clip landed at; undefined when re-flowed sequentially. */
  placedAt?: number;
  requestedAt?: number;
  /** True when a collision nudged the clip past `requestedAt`. */
  nudged: boolean;
  trimmedClipIds: string[];
  removedClipIds: string[];
}

/**
 * Move a clip to another track and/or timeline position. A bare `--track`
 * move keeps the clip's current computed position; collisions on the
 * destination nudge forward unless `overwrite`. Always writes an explicit
 * TimelineTrackRef (healing legacy orphan clips).
 */
export async function moveTimelineClip(
  pb: TypedPocketBase,
  clipId: string,
  opts: MoveTimelineClipOptions
): Promise<MoveClipResult> {
  if (opts.sequential && opts.at !== undefined) {
    throw new Error('--sequential and --at are mutually exclusive.');
  }
  if (opts.overwrite && opts.at === undefined) {
    throw new Error('--overwrite requires --at <seconds>.');
  }
  if (!opts.track && opts.at === undefined && !opts.sequential) {
    throw new Error('Pass --track, --at, and/or --sequential.');
  }

  const clipMutator = new TimelineClipMutator(pb);
  const clip = await clipMutator.getById(clipId);
  if (!clip) {
    throw new Error(`Timeline clip not found: ${clipId}`);
  }
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
  let placedAt: number | undefined;
  let requestedAt: number | undefined;
  let nudged = false;
  const trimmedClipIds: string[] = [];
  const removedClipIds: string[] = [];

  if (opts.sequential) {
    // BaseMutator.update skips schema validation, so null clears the field
    patch.timelineStart = null as unknown as number;
  } else {
    let targetAt = opts.at;
    if (targetAt === undefined) {
      // keep the clip's current computed position when only changing tracks
      const currentLane = clipsOnTrack(allClips, trackList, currentTrack.id);
      const sorted = getSortedTrackClips(currentLane);
      const ranges = getClipRanges(currentLane);
      const index = sorted.findIndex((c) => c.id === clipId);
      targetAt = index >= 0 ? ranges[index].start : (clip.timelineStart ?? 0);
    }
    requestedAt = targetAt;

    const destClips = clipsOnTrack(allClips, trackList, destTrack.id);
    if (opts.overwrite) {
      const others = destClips.filter((c) => c.id !== clipId);
      const plan = planOverwriteAtTime(others, targetAt, duration);
      for (const trim of plan.trims) {
        await clipMutator.update(trim.clipId, {
          start: trim.start,
          end: trim.end,
          duration: trim.end - trim.start,
          timelineStart: trim.timelineStart,
        });
        trimmedClipIds.push(trim.clipId);
      }
      for (const removeId of plan.removals) {
        await clipMutator.delete(removeId);
        removedClipIds.push(removeId);
      }
      if (removedClipIds.length > 0) {
        const remaining = allClips.filter(
          (c) => !removedClipIds.includes(c.id)
        );
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
  }

  const updated = await clipMutator.update(clipId, patch);
  await syncTimelineDuration(pb, timelineId);

  return {
    clip: updated,
    track: destTrack,
    placedAt,
    requestedAt,
    nudged,
    trimmedClipIds,
    removedClipIds,
  };
}

/**
 * Remove a clip, re-number the remaining clips densely (0..n-1), and re-sync
 * the timeline duration (webapp removeClipFromTimeline semantics).
 */
export async function removeTimelineClip(
  pb: TypedPocketBase,
  clipId: string
): Promise<TimelineClip> {
  const clipMutator = new TimelineClipMutator(pb);
  const clip = await clipMutator.getById(clipId);
  if (!clip) {
    throw new Error(`Timeline clip not found: ${clipId}`);
  }

  await clipMutator.delete(clipId);
  const remaining = await clipMutator.getByTimeline(clip.TimelineRef);
  await renumberClips(pb, clip.TimelineRef, remaining);
  await syncTimelineDuration(pb, clip.TimelineRef);
  return clip;
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
