import {
  MediaMutator,
  TimelineClipMutator,
  TimelineMutator,
  TimelineRenderMutator,
  TimelineTrackMutator,
  TaskStatus,
  generateTracks,
  validateTimeRange,
  type RenderTimelineConfig,
  type TimelineClip,
  type TimelineClipInput,
  type TimelineRender,
  type TypedPocketBase,
} from '@project/shared';

/**
 * Insert/render orchestration for the CLI, built directly on @project/shared
 * mutators. This mirrors the relevant parts of webapp's TimelineService
 * (addClipToTimeline / createRenderTask) without depending on the webapp.
 */

export function singleMediaType(mediaType: string | string[]): string {
  return Array.isArray(mediaType) ? mediaType[0] : mediaType;
}

/** Resolve the target track, creating a default layer-0 track if none exist. */
async function resolveTargetTrack(
  pb: TypedPocketBase,
  timelineId: string,
  trackId?: string
): Promise<string> {
  if (trackId) return trackId;

  const trackMutator = new TimelineTrackMutator(pb);
  const tracks = await trackMutator.getByTimeline(timelineId);
  const defaultTrack =
    tracks.items.find((t) => t.layer === 0) ?? tracks.items[0];
  if (defaultTrack) return defaultTrack.id;

  const created = await trackMutator.create({
    TimelineRef: timelineId,
    name: 'Main Track',
    layer: 0,
  });
  return created.id;
}

export interface InsertClipOptions {
  timelineId: string;
  mediaId: string;
  /** Trim start in source media (seconds). Defaults to 0. */
  start?: number;
  /** Trim end in source media (seconds). Defaults to the media duration. */
  end?: number;
  /** Target track id. Defaults to (or creates) the layer-0 track. */
  trackId?: string;
}

/** Append a media clip to a timeline. Returns the created TimelineClip. */
export async function insertClip(
  pb: TypedPocketBase,
  opts: InsertClipOptions
): Promise<TimelineClip> {
  const media = await new MediaMutator(pb).getById(opts.mediaId);
  if (!media) {
    throw new Error(`Media not found: ${opts.mediaId}`);
  }

  const start = opts.start ?? 0;
  const end = opts.end ?? media.duration;
  const mediaType = singleMediaType(media.mediaType);

  if (!validateTimeRange(start, end, media.duration, mediaType)) {
    throw new Error(
      `Invalid time range: start=${start}, end=${end}, media duration=${media.duration}`
    );
  }

  const targetTrackId = await resolveTargetTrack(
    pb,
    opts.timelineId,
    opts.trackId
  );

  const clipMutator = new TimelineClipMutator(pb);
  const order = (await clipMutator.getMaxOrder(opts.timelineId)) + 1;

  const input: TimelineClipInput = {
    TimelineRef: opts.timelineId,
    TimelineTrackRef: targetTrackId,
    MediaRef: opts.mediaId,
    order,
    start,
    end,
    duration: end - start,
  };

  return clipMutator.create(input);
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
