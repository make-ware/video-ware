import { InvalidArgumentError } from 'commander';
import {
  MAX_TIMELINE_TRACKS,
  TimelineClipMutator,
  TimelineTrackMutator,
  type TimelineTrackRecord,
  type TimelineTrackRecordInput,
  type TypedPocketBase,
} from '@project/shared';
import { parseUnitInterval, type OptionGroupOf } from './options.js';
import {
  clipsOnTrack,
  renumberClips,
  resolveTrackRef,
  syncTimelineDuration,
} from './timeline.js';

/** Track CRUD for the CLI, mirroring webapp TimelineService track methods. */

/** Parse a `--layer` value: a non-negative integer. */
export function parseLayer(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new InvalidArgumentError('expected a non-negative integer layer');
  }
  return n;
}

export interface TrackFieldOptions {
  name?: string;
  /** Editor-facing name (searchable). */
  label?: string;
  /** Editor-facing notes (searchable). */
  description?: string;
  /** Audio level 0..1. */
  volume?: number;
  /** Video opacity 0..1. */
  opacity?: number;
}

/** `track create`/`track update` flags for the TrackFieldOptions fields. */
export const trackFieldOptions = {
  name: { flags: '--name <text>', description: 'track name' },
  label: {
    flags: '--label <text>',
    description: 'track name shown in the editor (searchable)',
  },
  description: {
    flags: '--description <text>',
    description: 'track notes shown in the editor (searchable)',
  },
  volume: {
    flags: '--volume <0-1>',
    description: 'audio level (0 = silent, 1 = full)',
    parse: parseUnitInterval,
  },
  opacity: {
    flags: '--opacity <0-1>',
    description: 'video opacity (0 = invisible, 1 = opaque)',
    parse: parseUnitInterval,
  },
} satisfies OptionGroupOf<TrackFieldOptions>;

/**
 * Resolve a track argument outside a known-timeline context: bare layer
 * integers need `timelineId`; record ids stand alone (the timeline, when
 * given, is verified).
 */
export async function resolveTrackArg(
  pb: TypedPocketBase,
  trackRef: string,
  timelineId?: string
): Promise<TimelineTrackRecord> {
  if (/^\d+$/.test(trackRef)) {
    if (!timelineId) {
      throw new Error(
        `Track layer ${trackRef} is ambiguous without a timeline — pass -t <timelineId> (or use the track record id).`
      );
    }
    return resolveTrackRef(pb, timelineId, trackRef);
  }
  const track = await new TimelineTrackMutator(pb).getById(trackRef);
  if (!track) {
    throw new Error(`Track not found: ${trackRef}`);
  }
  if (timelineId && track.TimelineRef !== timelineId) {
    throw new Error(
      `Track ${trackRef} belongs to a different timeline (${track.TimelineRef}).`
    );
  }
  return track;
}

export interface CreateTrackOptions extends TrackFieldOptions {
  timelineId: string;
  muted?: boolean;
  locked?: boolean;
}

/**
 * Create a track on the next layer up (webapp semantics: layer = max + 1,
 * default name `Track {layer}`, at most MAX_TIMELINE_TRACKS tracks).
 */
export async function createTrack(
  pb: TypedPocketBase,
  opts: CreateTrackOptions
): Promise<TimelineTrackRecord> {
  const trackMutator = new TimelineTrackMutator(pb);
  const tracks = await trackMutator.getByTimeline(opts.timelineId);
  if (tracks.items.length >= MAX_TIMELINE_TRACKS) {
    throw new Error(
      `Timeline already has ${tracks.items.length} tracks (max ${MAX_TIMELINE_TRACKS}).`
    );
  }
  const layer = Math.max(-1, ...tracks.items.map((t) => t.layer)) + 1;

  const input: TimelineTrackRecordInput = {
    TimelineRef: opts.timelineId,
    name: opts.name ?? `Track ${layer}`,
    layer,
    ...(opts.label !== undefined ? { label: opts.label } : {}),
    ...(opts.description !== undefined
      ? { description: opts.description }
      : {}),
    ...(opts.volume !== undefined ? { volume: opts.volume } : {}),
    ...(opts.opacity !== undefined ? { opacity: opts.opacity } : {}),
    ...(opts.muted !== undefined ? { isMuted: opts.muted } : {}),
    ...(opts.locked !== undefined ? { isLocked: opts.locked } : {}),
  };
  return trackMutator.create(input);
}

export interface TrackWithClipCount {
  track: TimelineTrackRecord;
  /** Clips on this track, counting orphan clips on the layer-0 default. */
  clipCount: number;
}

/** List a timeline's tracks (layer ascending) with per-track clip counts. */
export async function listTracks(
  pb: TypedPocketBase,
  timelineId: string
): Promise<{ items: TrackWithClipCount[]; totalItems: number }> {
  const tracks = await new TimelineTrackMutator(pb).getByTimeline(timelineId);
  const clips = await new TimelineClipMutator(pb).getByTimeline(timelineId);
  const items = tracks.items.map((track) => ({
    track,
    clipCount: clipsOnTrack(clips, tracks.items, track.id).length,
  }));
  return { items, totalItems: tracks.totalItems };
}

export interface UpdateTrackOptions extends TrackFieldOptions {
  /** Track: layer number (needs timelineId) or record id. */
  track: string;
  timelineId?: string;
  muted?: boolean;
  locked?: boolean;
  /** New layer. If another track holds it, the two swap layers. */
  layer?: number;
}

export interface UpdateTrackResult {
  track: TimelineTrackRecord;
  /** The track that gave up the requested layer, when a swap happened. */
  swappedWith?: TimelineTrackRecord;
}

/**
 * Patch a track's fields. A `layer` change swaps with the current holder of
 * that layer so layers stay unique (two sequential updates, not a
 * transaction).
 */
export async function updateTrack(
  pb: TypedPocketBase,
  opts: UpdateTrackOptions
): Promise<UpdateTrackResult> {
  const track = await resolveTrackArg(pb, opts.track, opts.timelineId);
  const trackMutator = new TimelineTrackMutator(pb);

  const patch: Partial<TimelineTrackRecord> = {
    ...(opts.name !== undefined ? { name: opts.name } : {}),
    ...(opts.label !== undefined ? { label: opts.label } : {}),
    ...(opts.description !== undefined
      ? { description: opts.description }
      : {}),
    ...(opts.volume !== undefined ? { volume: opts.volume } : {}),
    ...(opts.opacity !== undefined ? { opacity: opts.opacity } : {}),
    ...(opts.muted !== undefined ? { isMuted: opts.muted } : {}),
    ...(opts.locked !== undefined ? { isLocked: opts.locked } : {}),
  };

  let swappedWith: TimelineTrackRecord | undefined;
  if (opts.layer !== undefined && opts.layer !== track.layer) {
    const siblings = await trackMutator.getByTimeline(track.TimelineRef);
    const holder = siblings.items.find(
      (t) => t.layer === opts.layer && t.id !== track.id
    );
    if (holder) {
      swappedWith = await trackMutator.update(holder.id, {
        layer: track.layer,
      });
    }
    patch.layer = opts.layer;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error('Nothing to update — pass at least one field flag.');
  }
  const updated = await trackMutator.update(track.id, patch);
  return { track: updated, swappedWith };
}

export interface DeleteTrackOptions {
  /** Track: layer number (needs timelineId) or record id. */
  track: string;
  timelineId?: string;
  /** Also delete the track's clips (otherwise refuse when clips exist). */
  deleteClips?: boolean;
}

export interface DeleteTrackResult {
  track: TimelineTrackRecord;
  deletedClipIds: string[];
}

/**
 * Delete a track. Refuses when the track still has clips unless
 * `deleteClips` is set (webapp semantics); deleting clips re-numbers the
 * remaining clips densely and re-syncs the timeline duration.
 */
export async function deleteTrack(
  pb: TypedPocketBase,
  opts: DeleteTrackOptions
): Promise<DeleteTrackResult> {
  const track = await resolveTrackArg(pb, opts.track, opts.timelineId);
  const timelineId = track.TimelineRef;

  const clipMutator = new TimelineClipMutator(pb);
  const allClips = await clipMutator.getByTimeline(timelineId);
  const trackClips = allClips.filter((c) => c.TimelineTrackRef === track.id);

  if (trackClips.length > 0 && !opts.deleteClips) {
    throw new Error(
      `Track ${track.id} has ${trackClips.length} clip(s) — pass --clips to delete them too.`
    );
  }

  for (const clip of trackClips) {
    await clipMutator.delete(clip.id);
  }
  await new TimelineTrackMutator(pb).delete(track.id);

  if (trackClips.length > 0) {
    const remaining = allClips.filter((c) => c.TimelineTrackRef !== track.id);
    await renumberClips(pb, timelineId, remaining);
    await syncTimelineDuration(pb, timelineId);
  }

  return { track, deletedClipIds: trackClips.map((c) => c.id) };
}
