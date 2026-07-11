import { InvalidArgumentError } from 'commander';
import {
  CaptionMutator,
  MAX_TIMELINE_TRACKS,
  MediaClipMutator,
  MediaMutator,
  TaskStatus,
  TimelineClipMutator,
  TimelineMutator,
  TimelineOrientation,
  TimelineRenderMutator,
  TimelineTrackMutator,
  calculateEffectiveDuration,
  computeClipPlacement,
  computeTimelineDuration,
  findNonOverlappingTimelineStart,
  getCompositeSegments,
  generateTracks,
  getClipRanges,
  getSortedTrackClips,
  planOverwriteAtTime,
  validateTimeRange,
  type ClipTrim,
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

/**
 * Segment-edit bounds for a media record: images have no upper time bound
 * (mirroring validateTimeRange), everything else clamps to the duration.
 */
export function mediaBounds(media: {
  mediaType: string | string[];
  duration: number;
}): { mediaDuration?: number } {
  return singleMediaType(media.mediaType) === 'image'
    ? {}
    : { mediaDuration: media.duration };
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
  /** Media id to insert (mutually exclusive with `clip`/`caption`). */
  media?: string;
  /** MediaClip id to insert; inherits its trim window, label, description. */
  clip?: string;
  /** Caption id to insert as a text/title clip (mutually exclusive with media/clip). */
  caption?: string;
  /** Trim start in the source (seconds). For captions, into the caption's cue timeline. Defaults to 0 (or the MediaClip's). */
  start?: number;
  /** Trim end in the source (seconds). Defaults to the media/caption duration (or the MediaClip's). */
  end?: number;
  /** Target track: layer number or record id. Defaults to (or creates) the layer-0 track. */
  track?: string;
  /** Place at this timeline time (seconds); omitted = append to end of track. */
  at?: number;
  /** Place right after this timeline clip; its track becomes the target. */
  after?: string;
  /** With `at`: trim/remove overlapped clips instead of nudging forward. */
  overwrite?: boolean;
  /** Compute and report the placement without writing anything. */
  dryRun?: boolean;
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
  caption: {
    flags: '--caption <id>',
    description: 'Caption id to insert as a text/title clip',
  },
  start: {
    flags: '-s, --start <seconds>',
    description:
      'trim start in the source (caption cue timeline for --caption)',
    parse: parseSeconds,
  },
  end: {
    flags: '-e, --end <seconds>',
    description: 'trim end in the source (caption cue timeline for --caption)',
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
      'place at this exact timeline time; nudges past collisions unless --overwrite',
    parse: parseSeconds,
  },
  after: {
    flags: '--after <clipId>',
    description: 'place right after this timeline clip (implies its track)',
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

/** How an inserted clip's timeline position was chosen. */
export type InsertPlacementMode = 'append' | 'after' | 'at';

export interface InsertClipResult {
  /** The created clip, or null on a dry run (nothing was written). */
  clip: TimelineClip | null;
  /** Timeline time the clip starts at. Clips are always explicitly placed. */
  placedAt: number;
  /** Timeline time the clip ends at (placedAt + duration). */
  placedEnd: number;
  mode: InsertPlacementMode;
  /** The clip this one lands after (append/after modes), if the track had one. */
  afterClip?: TimelineClip;
  /** Timeline time that was requested (`at`, or the after-clip's end). */
  requestedAt?: number;
  /** True when a collision nudged the clip past `requestedAt`. */
  nudged: boolean;
  /** Trims applied (or planned, on a dry run) to overwritten clips. */
  trims: ClipTrim[];
  trimmedClipIds: string[];
  removedClipIds: string[];
  track: TimelineTrackRecord;
  dryRun: boolean;
}

/**
 * Insert a media clip into a timeline. Returns the created clip + placement.
 *
 * Every clip is written with an explicit `timelineStart`: PocketBase number
 * fields cannot round-trip "unset" (an omitted value is stored and returned
 * as 0), so sequential-flow placement would collapse every clip onto 0s.
 * Without `at`/`after` the clip is appended at the end of the target track —
 * the same placement the webapp computes when a clip is added.
 */
export async function insertClip(
  pb: TypedPocketBase,
  opts: InsertClipOptions
): Promise<InsertClipResult> {
  const sources = [opts.media, opts.clip, opts.caption].filter(Boolean);
  if (sources.length === 0) {
    throw new Error(
      'Pass --media <id>, --clip <mediaClipId>, or --caption <captionId>.'
    );
  }
  if (sources.length > 1) {
    throw new Error('--media, --clip, and --caption are mutually exclusive.');
  }
  if (opts.at !== undefined && opts.after) {
    throw new Error('--at and --after are mutually exclusive.');
  }
  if (opts.overwrite && opts.at === undefined) {
    throw new Error('--overwrite requires --at <seconds>.');
  }

  // Resolve the clip's source (media/MediaClip or caption): its trim window,
  // duration, provenance ref, and default label/description. Placement below
  // is identical for every source — it only needs `duration`.
  let mediaId: string | undefined;
  let mediaClip: Awaited<ReturnType<MediaClipMutator['getById']>> | undefined;
  let caption: Awaited<ReturnType<CaptionMutator['getById']>> | undefined;
  let start: number;
  let end: number;
  let defaultLabel: string | undefined;
  let defaultDescription: string | undefined;

  if (opts.caption) {
    caption = await new CaptionMutator(pb).getById(opts.caption);
    if (!caption) {
      throw new Error(`Caption not found: ${opts.caption}`);
    }
    // start/end trim the caption's own cue timeline (mirroring how a media
    // clip trims source media). A fresh caption clip spans [0, duration].
    start = opts.start ?? 0;
    end = opts.end ?? caption.duration;
    if (!(start >= 0 && start < end)) {
      throw new Error(
        `Invalid caption time range: start=${start}, end=${end}.`
      );
    }
    defaultLabel = opts.label;
    defaultDescription = opts.description;
  } else {
    mediaClip = opts.clip
      ? await new MediaClipMutator(pb).getById(opts.clip)
      : undefined;
    if (opts.clip && !mediaClip) {
      throw new Error(`MediaClip not found: ${opts.clip}`);
    }

    mediaId = mediaClip ? mediaClip.MediaRef : opts.media!;
    const media = await new MediaMutator(pb).getById(mediaId);
    if (!media) {
      throw new Error(`Media not found: ${mediaId}`);
    }

    start = opts.start ?? mediaClip?.start ?? 0;
    end = opts.end ?? mediaClip?.end ?? media.duration;
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
    defaultLabel = opts.label ?? mediaClip?.label;
    defaultDescription = opts.description ?? mediaClip?.description;
  }
  // Composite MediaClips play their segments (gaps skipped), so the stored
  // duration and the placement math below must use the effective length —
  // end - start would over-reserve lane space and mismatch the render.
  const compositeSegments = getCompositeSegments(mediaClip ?? undefined);
  const duration = compositeSegments
    ? calculateEffectiveDuration(start, end, compositeSegments)
    : end - start;

  const trackMutator = new TimelineTrackMutator(pb);
  const clipMutator = new TimelineClipMutator(pb);

  const trackList = (await trackMutator.getByTimeline(opts.timelineId)).items;
  const allClips = await clipMutator.getByTimeline(opts.timelineId);
  const defaultTrack = trackList.find((t) => t.layer === 0) ?? trackList[0];

  let afterClip = opts.after
    ? allClips.find((c) => c.id === opts.after)
    : undefined;
  if (opts.after && !afterClip) {
    throw new Error(
      `Clip ${opts.after} is not on timeline ${opts.timelineId} — ` +
        `list clips with \`vw timeline clips list -t ${opts.timelineId}\`.`
    );
  }

  let targetTrack: TimelineTrackRecord | undefined;
  if (opts.track) {
    targetTrack = await resolveTrackRef(pb, opts.timelineId, opts.track);
  }
  if (afterClip) {
    const afterTrackId = afterClip.TimelineTrackRef ?? defaultTrack?.id;
    const afterTrack = trackList.find((t) => t.id === afterTrackId);
    if (!afterTrack) {
      throw new Error(
        `Clip ${afterClip.id} references missing track ${afterTrackId}.`
      );
    }
    if (targetTrack && targetTrack.id !== afterTrack.id) {
      throw new Error(
        `--after clip ${afterClip.id} lives on track layer ${afterTrack.layer}, ` +
          'not the requested --track — drop one of the two flags.'
      );
    }
    targetTrack = afterTrack;
  }
  if (!targetTrack) {
    targetTrack = defaultTrack;
    if (!targetTrack) {
      targetTrack = await trackMutator.create({
        TimelineRef: opts.timelineId,
        name: 'Main Track',
        layer: 0,
      });
      trackList.push(targetTrack);
    }
  }

  let order = Math.max(-1, ...allClips.map((c) => c.order)) + 1;
  const trackClips = clipsOnTrack(allClips, trackList, targetTrack.id);

  let placedAt: number;
  let requestedAt: number | undefined;
  let mode: InsertPlacementMode;
  let nudged = false;
  const trims: ClipTrim[] = [];
  const trimmedClipIds: string[] = [];
  const removedClipIds: string[] = [];

  if (opts.at !== undefined) {
    mode = 'at';
    requestedAt = opts.at;

    if (opts.overwrite) {
      const plan = planOverwriteAtTime(trackClips, opts.at, duration);
      trims.push(...plan.trims);
      for (const trim of plan.trims) {
        if (!opts.dryRun) {
          await clipMutator.update(trim.clipId, {
            start: trim.start,
            end: trim.end,
            // effective length from the planner — for composites this is the
            // windowed gap-skipping sum, not end - start
            duration: trim.duration,
            timelineStart: trim.timelineStart,
          });
        }
        trimmedClipIds.push(trim.clipId);
      }
      for (const clipId of plan.removals) {
        if (!opts.dryRun) {
          await clipMutator.delete(clipId);
        }
        removedClipIds.push(clipId);
      }
      if (removedClipIds.length > 0 && !opts.dryRun) {
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
  } else if (afterClip) {
    mode = 'after';
    const target = afterClip;
    const sorted = getSortedTrackClips(trackClips);
    const ranges = getClipRanges(trackClips);
    const index = sorted.findIndex((c) => c.id === target.id);
    requestedAt = ranges[index].end;
    placedAt = findNonOverlappingTimelineStart(
      trackClips,
      requestedAt,
      duration
    );
    nudged = placedAt !== requestedAt;
  } else {
    mode = 'append';
    placedAt = computeClipPlacement(trackClips, null, duration);
    // report which clip this one butts up against: the one ending last
    const sorted = getSortedTrackClips(trackClips);
    const ranges = getClipRanges(trackClips);
    let furthestEnd = -1;
    ranges.forEach((range, i) => {
      if (range.end > furthestEnd) {
        furthestEnd = range.end;
        afterClip = sorted[i];
      }
    });
  }

  // Caption clips carry the display title in meta (matching the webapp's
  // addCaptionToTimeline); gain applies to either kind of clip.
  const meta: NonNullable<TimelineClipInput['meta']> = {};
  if (caption) meta.title = caption.name || caption.text;
  if (opts.gain !== undefined) meta.gain = opts.gain;

  const input: TimelineClipInput = {
    TimelineRef: opts.timelineId,
    TimelineTrackRef: targetTrack.id,
    ...(mediaId ? { MediaRef: mediaId } : {}),
    ...(mediaClip ? { MediaClipRef: mediaClip.id } : {}),
    ...(caption ? { CaptionRef: caption.id } : {}),
    ...(defaultLabel !== undefined ? { label: defaultLabel } : {}),
    ...(defaultDescription !== undefined
      ? { description: defaultDescription }
      : {}),
    order,
    start,
    end,
    duration,
    timelineStart: placedAt,
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
  };

  let clip: TimelineClip | null = null;
  if (!opts.dryRun) {
    clip = await clipMutator.create(input);
    await syncTimelineDuration(pb, opts.timelineId);
  }

  return {
    clip,
    placedAt,
    placedEnd: placedAt + duration,
    mode,
    ...(afterClip ? { afterClip } : {}),
    requestedAt,
    nudged,
    trims,
    trimmedClipIds,
    removedClipIds,
    track: targetTrack,
    dryRun: !!opts.dryRun,
  };
}

export interface InsertClipsOptions {
  timelineId: string;
  /** MediaClip ids to append, in order. */
  clipIds: string[];
  /** Target track: layer number or record id. Defaults to the layer-0 track. */
  track?: string;
  /** Per-clip audio gain multiplier (0..1), applied to every clip. */
  gain?: number;
}

/**
 * Append a batch of MediaClips to a timeline track, in order. Each insert
 * re-reads the track state, so every clip butts up against the previous one.
 */
export async function insertClips(
  pb: TypedPocketBase,
  opts: InsertClipsOptions
): Promise<InsertClipResult[]> {
  const results: InsertClipResult[] = [];
  for (const clipId of opts.clipIds) {
    results.push(
      await insertClip(pb, {
        timelineId: opts.timelineId,
        clip: clipId,
        ...(opts.track !== undefined ? { track: opts.track } : {}),
        ...(opts.gain !== undefined ? { gain: opts.gain } : {}),
      })
    );
  }
  return results;
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
