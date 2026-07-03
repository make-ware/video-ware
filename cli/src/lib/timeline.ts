import { InvalidArgumentError } from 'commander';
import {
  MAX_TIMELINE_TRACKS,
  MediaClipMutator,
  MediaMutator,
  TaskStatus,
  TimelineClipMutator,
  TimelineMutator,
  TimelineOrientation,
  TimelineRenderMutator,
  TimelineTrackMutator,
  computeTimelineDuration,
  findNonOverlappingTimelineStart,
  generateTracks,
  planOverwriteAtTime,
  validateTimeRange,
  type RenderTimelineConfig,
  type Timeline,
  type TimelineClip,
  type TimelineClipInput,
  type TimelineRender,
  type TimelineTrackRecord,
  type TypedPocketBase,
} from '@project/shared';
import {
  parseSeconds,
  parseUnitInterval,
  type OptionGroupOf,
} from './options.js';

/**
 * Timeline orchestration for the CLI, built directly on @project/shared
 * mutators. This mirrors the relevant parts of webapp's TimelineService
 * (createTimeline / addClipToTimeline / createRenderTask) without depending
 * on the webapp.
 */

export function singleMediaType(mediaType: string | string[]): string {
  return Array.isArray(mediaType) ? mediaType[0] : mediaType;
}

/** Validate an orientation flag against the TimelineOrientation enum. */
export function parseOrientation(value: string): TimelineOrientation {
  const values = Object.values(TimelineOrientation) as string[];
  if (!values.includes(value)) {
    throw new InvalidArgumentError(`expected one of: ${values.join(', ')}`);
  }
  return value as TimelineOrientation;
}

/** Parse the comma-separated `--tracks` names for `timeline create`. */
export function parseTrackNames(value: string): string[] {
  const names = value
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  if (names.length === 0) {
    throw new InvalidArgumentError('expected comma-separated track names');
  }
  return names;
}

export interface CreateTimelineOptions {
  workspaceId: string;
  name: string;
  /** Editor-facing name (searchable). */
  label?: string;
  /** Editor-facing notes (searchable). */
  description?: string;
  orientation?: TimelineOrientation;
  /** Track names, layered bottom-up from 0. Defaults to one "Main Track". */
  tracks?: string[];
}

/** `timeline create` flags for the optional CreateTimelineOptions fields. */
export const timelineCreateOptions = {
  label: {
    flags: '--label <text>',
    description: 'timeline name shown in the editor (searchable)',
  },
  description: {
    flags: '--description <text>',
    description: 'timeline notes shown in the editor (searchable)',
  },
  orientation: {
    flags: '--orientation <o>',
    description: 'landscape or portrait',
    parse: parseOrientation,
  },
  tracks: {
    flags: '--tracks <names>',
    description:
      'comma-separated track names, layered bottom-up from 0 ' +
      '(e.g. "Music,Interview,B-Roll"; default: "Main Track")',
    parse: parseTrackNames,
  },
} satisfies OptionGroupOf<CreateTimelineOptions>;

/**
 * Create a timeline plus its tracks. Mirrors webapp createTimeline: without
 * `tracks` a single layer-0 "Main Track" is created.
 */
export async function createTimeline(
  pb: TypedPocketBase,
  opts: CreateTimelineOptions
): Promise<{ timeline: Timeline; tracks: TimelineTrackRecord[] }> {
  const names = opts.tracks?.length ? opts.tracks : ['Main Track'];
  if (names.length > MAX_TIMELINE_TRACKS) {
    throw new Error(
      `A timeline supports at most ${MAX_TIMELINE_TRACKS} tracks (${names.length} requested).`
    );
  }

  const timeline = await new TimelineMutator(pb).create({
    name: opts.name,
    WorkspaceRef: opts.workspaceId,
    duration: 0,
    version: 1,
    ...(opts.label !== undefined ? { label: opts.label } : {}),
    ...(opts.description !== undefined
      ? { description: opts.description }
      : {}),
    ...(opts.orientation ? { orientation: opts.orientation } : {}),
  });

  const trackMutator = new TimelineTrackMutator(pb);
  const tracks: TimelineTrackRecord[] = [];
  for (const [layer, name] of names.entries()) {
    tracks.push(
      await trackMutator.create({ TimelineRef: timeline.id, name, layer })
    );
  }

  return { timeline, tracks };
}

export interface TimelineFieldPatch {
  name?: string;
  label?: string;
  description?: string;
  orientation?: TimelineOrientation;
}

/** `timeline update` flags for the TimelineFieldPatch fields. */
export const timelineUpdateOptions = {
  name: { flags: '--name <text>', description: 'timeline name' },
  label: timelineCreateOptions.label,
  description: timelineCreateOptions.description,
  orientation: timelineCreateOptions.orientation,
} satisfies OptionGroupOf<TimelineFieldPatch>;

/** Patch a timeline's editable fields. */
export async function updateTimeline(
  pb: TypedPocketBase,
  timelineId: string,
  patch: TimelineFieldPatch
): Promise<Timeline> {
  if (Object.keys(patch).length === 0) {
    throw new Error('Nothing to update — pass at least one field flag.');
  }
  const mutator = new TimelineMutator(pb);
  const existing = await mutator.getById(timelineId);
  if (!existing) {
    throw new Error(`Timeline not found: ${timelineId}`);
  }
  return mutator.update(timelineId, patch);
}

/**
 * Resolve a `--track` value to a track record: a bare integer matches the
 * track at that layer, anything else is treated as a track record id.
 * (PocketBase record ids are 15-char alphanumeric, never bare integers.)
 */
export async function resolveTrackRef(
  pb: TypedPocketBase,
  timelineId: string,
  ref: string
): Promise<TimelineTrackRecord> {
  const trackMutator = new TimelineTrackMutator(pb);

  if (/^\d+$/.test(ref)) {
    const layer = parseInt(ref, 10);
    const tracks = await trackMutator.getByTimeline(timelineId);
    const matches = tracks.items.filter((t) => t.layer === layer);
    if (matches.length === 0) {
      throw new Error(
        `No track with layer ${layer} on timeline ${timelineId} — ` +
          `list tracks with \`vw timeline track list -t ${timelineId}\`.`
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `Multiple tracks have layer ${layer} — pass the track record id instead.`
      );
    }
    return matches[0];
  }

  const track = await trackMutator.getById(ref);
  if (!track) {
    throw new Error(`Track not found: ${ref}`);
  }
  if (track.TimelineRef !== timelineId) {
    throw new Error(
      `Track ${ref} belongs to a different timeline (${track.TimelineRef}).`
    );
  }
  return track;
}

/**
 * The clips that live on a track, including orphan clips (no TimelineTrackRef)
 * when the track is the layer-0 default — mirroring buildPlaybackTracks'
 * fallback so placement math sees the same lane the player renders.
 */
export function clipsOnTrack(
  allClips: TimelineClip[],
  allTracks: TimelineTrackRecord[],
  trackId: string
): TimelineClip[] {
  const defaultTrack = allTracks.find((t) => t.layer === 0) ?? allTracks[0];
  return allClips.filter(
    (c) => (c.TimelineTrackRef ?? defaultTrack?.id) === trackId
  );
}

/**
 * Re-number a timeline's clips densely (order 0..n-1), preserving relative
 * order. Only clips whose order actually changes are written.
 */
export async function renumberClips(
  pb: TypedPocketBase,
  timelineId: string,
  clips: TimelineClip[]
): Promise<void> {
  const sorted = [...clips].sort((a, b) => a.order - b.order);
  const changes = sorted
    .map((clip, index) => ({ id: clip.id, order: index }))
    .filter((change, index) => sorted[index].order !== change.order);
  if (changes.length > 0) {
    await new TimelineClipMutator(pb).reorderClips(timelineId, changes);
  }
}

/**
 * Recompute the timeline's duration from placed clips (furthest clip end
 * across tracks) and persist it when stale. Called after clip mutations.
 */
export async function syncTimelineDuration(
  pb: TypedPocketBase,
  timelineId: string
): Promise<number> {
  const clips = await new TimelineClipMutator(pb).getByTimeline(timelineId);
  const tracks = await new TimelineTrackMutator(pb).getByTimeline(timelineId);
  const duration = computeTimelineDuration(clips, tracks.items);

  const timelineMutator = new TimelineMutator(pb);
  const timeline = await timelineMutator.getById(timelineId);
  if (timeline && timeline.duration !== duration) {
    await timelineMutator.update(timelineId, { duration });
  }
  return duration;
}

export interface InsertClipOptions {
  timelineId: string;
  /** Media id to insert (mutually exclusive with `clip`). */
  media?: string;
  /** MediaClip id to insert; inherits its trim window, label, description. */
  clip?: string;
  /** Trim start in source media (seconds). Defaults to 0 (or the MediaClip's). */
  start?: number;
  /** Trim end in source media (seconds). Defaults to the media duration (or the MediaClip's). */
  end?: number;
  /** Target track: layer number or record id. Defaults to (or creates) the layer-0 track. */
  track?: string;
  /** Place at this timeline time (seconds); omitted = sequential append. */
  at?: number;
  /** With `at`: trim/remove overlapped clips instead of nudging forward. */
  overwrite?: boolean;
  /** Editor-facing clip name; overrides the MediaClip's label. */
  label?: string;
  /** Editor-facing clip notes; overrides the MediaClip's description. */
  description?: string;
  /** Per-clip audio gain multiplier (0..1). */
  gain?: number;
}

/** `timeline insert` flags for the optional InsertClipOptions fields. */
export const insertOptions = {
  media: { flags: '-m, --media <id>', description: 'media id to insert' },
  clip: {
    flags: '--clip <id>',
    description:
      'MediaClip id to insert (inherits its trim window, label, description)',
  },
  start: {
    flags: '-s, --start <seconds>',
    description: 'trim start in source media',
    parse: parseSeconds,
  },
  end: {
    flags: '-e, --end <seconds>',
    description: 'trim end in source media',
    parse: parseSeconds,
  },
  track: {
    flags: '--track <layer|id>',
    description:
      'target track: layer number or track record id (default: layer 0)',
  },
  at: {
    flags: '--at <seconds>',
    description:
      'place at this timeline time; nudges past collisions unless --overwrite',
    parse: parseSeconds,
  },
  label: {
    flags: '--label <text>',
    description: 'clip name shown in the editor (searchable)',
  },
  description: {
    flags: '--description <text>',
    description: 'clip notes shown in the editor (searchable)',
  },
  gain: {
    flags: '--gain <0-1>',
    description: 'per-clip audio gain multiplier',
    parse: parseUnitInterval,
  },
} satisfies OptionGroupOf<InsertClipOptions>;

export interface InsertClipResult {
  clip: TimelineClip;
  /** Timeline time the clip landed at; undefined for sequential append. */
  placedAt?: number;
  /** Timeline time that was requested via `at`. */
  requestedAt?: number;
  /** True when a collision nudged the clip past `requestedAt`. */
  nudged: boolean;
  trimmedClipIds: string[];
  removedClipIds: string[];
}

/** Insert a media clip into a timeline. Returns the created clip + placement. */
export async function insertClip(
  pb: TypedPocketBase,
  opts: InsertClipOptions
): Promise<InsertClipResult> {
  if (!opts.media && !opts.clip) {
    throw new Error('Pass --media <id> or --clip <mediaClipId>.');
  }
  if (opts.media && opts.clip) {
    throw new Error('--media and --clip are mutually exclusive.');
  }
  if (opts.overwrite && opts.at === undefined) {
    throw new Error('--overwrite requires --at <seconds>.');
  }

  const mediaClip = opts.clip
    ? await new MediaClipMutator(pb).getById(opts.clip)
    : undefined;
  if (opts.clip && !mediaClip) {
    throw new Error(`MediaClip not found: ${opts.clip}`);
  }

  const mediaId = mediaClip ? mediaClip.MediaRef : opts.media!;
  const media = await new MediaMutator(pb).getById(mediaId);
  if (!media) {
    throw new Error(`Media not found: ${mediaId}`);
  }

  const start = opts.start ?? mediaClip?.start ?? 0;
  const end = opts.end ?? mediaClip?.end ?? media.duration;
  const mediaType = singleMediaType(media.mediaType);

  if (!validateTimeRange(start, end, media.duration, mediaType)) {
    if (mediaType === 'image' && opts.end === undefined && !mediaClip) {
      throw new Error(
        'Image media has no intrinsic duration — pass an explicit --end (seconds to display).'
      );
    }
    throw new Error(
      `Invalid time range: start=${start}, end=${end}, media duration=${media.duration}`
    );
  }
  const duration = end - start;

  const trackMutator = new TimelineTrackMutator(pb);
  const clipMutator = new TimelineClipMutator(pb);

  const trackList = (await trackMutator.getByTimeline(opts.timelineId)).items;
  let targetTrack: TimelineTrackRecord | undefined;
  if (opts.track) {
    targetTrack = await resolveTrackRef(pb, opts.timelineId, opts.track);
  } else {
    targetTrack = trackList.find((t) => t.layer === 0) ?? trackList[0];
    if (!targetTrack) {
      targetTrack = await trackMutator.create({
        TimelineRef: opts.timelineId,
        name: 'Main Track',
        layer: 0,
      });
      trackList.push(targetTrack);
    }
  }

  const allClips = await clipMutator.getByTimeline(opts.timelineId);
  let order = Math.max(-1, ...allClips.map((c) => c.order)) + 1;

  let placedAt: number | undefined;
  let nudged = false;
  const trimmedClipIds: string[] = [];
  const removedClipIds: string[] = [];

  if (opts.at !== undefined) {
    const trackClips = clipsOnTrack(allClips, trackList, targetTrack.id);

    if (opts.overwrite) {
      const plan = planOverwriteAtTime(trackClips, opts.at, duration);
      for (const trim of plan.trims) {
        await clipMutator.update(trim.clipId, {
          start: trim.start,
          end: trim.end,
          duration: trim.end - trim.start,
          timelineStart: trim.timelineStart,
        });
        trimmedClipIds.push(trim.clipId);
      }
      for (const clipId of plan.removals) {
        await clipMutator.delete(clipId);
        removedClipIds.push(clipId);
      }
      if (removedClipIds.length > 0) {
        const remaining = allClips.filter(
          (c) => !removedClipIds.includes(c.id)
        );
        await renumberClips(pb, opts.timelineId, remaining);
        order = remaining.length;
      }
      placedAt = opts.at;
    } else {
      placedAt = findNonOverlappingTimelineStart(trackClips, opts.at, duration);
      nudged = placedAt !== opts.at;
    }
  }

  const label = opts.label ?? mediaClip?.label;
  const description = opts.description ?? mediaClip?.description;

  const input: TimelineClipInput = {
    TimelineRef: opts.timelineId,
    TimelineTrackRef: targetTrack.id,
    MediaRef: mediaId,
    ...(mediaClip ? { MediaClipRef: mediaClip.id } : {}),
    ...(label !== undefined ? { label } : {}),
    ...(description !== undefined ? { description } : {}),
    order,
    start,
    end,
    duration,
    ...(placedAt !== undefined ? { timelineStart: placedAt } : {}),
    ...(opts.gain !== undefined ? { meta: { gain: opts.gain } } : {}),
  };

  const clip = await clipMutator.create(input);
  await syncTimelineDuration(pb, opts.timelineId);

  return {
    clip,
    placedAt,
    requestedAt: opts.at,
    nudged,
    trimmedClipIds,
    removedClipIds,
  };
}

/** Fail fast on the conditions that would make a render meaningless. */
async function assertRenderable(
  pb: TypedPocketBase,
  timelineId: string
): Promise<void> {
  const clips = await new TimelineClipMutator(pb).getByTimeline(timelineId);
  if (clips.length === 0) {
    throw new Error('Timeline has no clips to render.');
  }

  const mediaMutator = new MediaMutator(pb);
  for (const clip of clips) {
    if (!clip.MediaRef && !clip.CaptionRef) {
      throw new Error(`Clip ${clip.id} has neither media nor caption.`);
    }
    if (!clip.MediaRef) continue; // caption clips validate elsewhere

    const media = await mediaMutator.getById(clip.MediaRef);
    if (!media) {
      throw new Error(
        `Clip ${clip.id} references missing media ${clip.MediaRef}.`
      );
    }
    const mediaType = singleMediaType(media.mediaType);
    if (!validateTimeRange(clip.start, clip.end, media.duration, mediaType)) {
      throw new Error(
        `Clip ${clip.id} time range (${clip.start}-${clip.end}) exceeds media duration ${media.duration}.`
      );
    }
  }
}

export interface CreateRenderOptions {
  timelineId: string;
  outputSettings: RenderTimelineConfig;
  /** User id for UserRef. Defaults to the authenticated user. */
  userId?: string;
}

/**
 * Create a TimelineRender record. A PocketBase hook turns this into a
 * `render_timeline` task that the worker picks up automatically; the same
 * record is updated with status/FileRef as the render progresses.
 */
export async function createRender(
  pb: TypedPocketBase,
  opts: CreateRenderOptions
): Promise<TimelineRender> {
  await assertRenderable(pb, opts.timelineId);

  const timeline = await new TimelineMutator(pb).getById(opts.timelineId);
  if (!timeline) {
    throw new Error(`Timeline not found: ${opts.timelineId}`);
  }

  const clips = await new TimelineClipMutator(pb).getByTimeline(
    opts.timelineId
  );
  const tracks = await new TimelineTrackMutator(pb).getByTimeline(
    opts.timelineId
  );
  const trackList = generateTracks(clips, tracks.items);

  const userId = opts.userId ?? pb.authStore.record?.id;

  return new TimelineRenderMutator(pb).create({
    TimelineRef: opts.timelineId,
    WorkspaceRef: timeline.WorkspaceRef,
    ...(userId ? { UserRef: userId } : {}),
    version: timeline.version ?? 0,
    timelineData: trackList,
    outputSettings: opts.outputSettings,
    status: TaskStatus.QUEUED,
    progress: 1,
  });
}
