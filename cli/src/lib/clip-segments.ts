import {
  ClipType,
  MediaClipMutator,
  MediaMutator,
  TimelineClipMutator,
  calculateEffectiveDuration,
  cutSegments,
  deriveClipTimes,
  getCompositeSegments,
  normalizeSegments,
  roundToMs,
  slipSegments,
  splitSegments,
  trimSegment,
  type CompositeSegment,
  type Media,
  type MediaClip,
  type TimelineClip,
  type TypedPocketBase,
} from '@project/shared';
import { mediaBounds, syncTimelineDuration } from './timeline.js';
import {
  assertOnTimeline,
  resolveTimelineEditList,
  rippleDownstreamClips,
  type RippleShift,
  type TimelineEditListSource,
} from './timeline-clip.js';

/**
 * Segment-level edit operations (split/cut/trim/slip) shared by
 * `vw media clip …` and `vw timeline clips …` — fine-tuning dialogue by
 * editing a clip's edit list instead of creating standalone clips.
 *
 * All times are source-media seconds. A clip that isn't composite yet is
 * auto-converted on its first edit: MediaClips get `type: 'composite'` +
 * `clipData.segments`, TimelineClips get a copy-on-write `meta.segments`
 * (initialized from the referenced composite MediaClip when present, else
 * the clip's own trim window). Every write derives `start`/`end`/`duration`
 * from the resulting segments, with `duration` the effective (gap-skipping)
 * length.
 */

/** One segment-level edit, applied identically in both clip domains. */
export type SegmentOp =
  | { kind: 'split'; at: number[] }
  | { kind: 'cut'; from: number; to: number }
  | { kind: 'trim'; segment?: number; start?: number; end?: number }
  | { kind: 'slip'; by: number; segment?: number };

export interface SegmentTimes {
  start: number;
  end: number;
  duration: number;
}

interface AppliedOp {
  segments: CompositeSegment[];
  /** slip only: the delta requested and the delta after clamping */
  requestedBy?: number;
  appliedBy?: number;
}

/**
 * Apply one op to a normalized edit list. `segments` must already be
 * normalized so `--segment` indices match what the `segments` command
 * prints; every underlying op re-normalizes defensively anyway.
 */
function applySegmentOp(
  segments: CompositeSegment[],
  op: SegmentOp,
  bounds: { mediaDuration?: number }
): AppliedOp {
  switch (op.kind) {
    case 'split':
      return { segments: splitSegments(segments, op.at, bounds) };
    case 'cut':
      return { segments: cutSegments(segments, op.from, op.to, bounds) };
    case 'trim': {
      let index = op.segment;
      if (index === undefined) {
        if (segments.length !== 1) {
          throw new Error(
            `This clip has ${segments.length} segments — pass --segment <n> ` +
              `(list them with the \`segments\` subcommand).`
          );
        }
        index = 0;
      }
      return {
        segments: trimSegment(
          segments,
          index,
          { start: op.start, end: op.end },
          bounds
        ),
      };
    }
    case 'slip': {
      const result = slipSegments(segments, op.by, {
        ...(op.segment !== undefined ? { index: op.segment } : {}),
        ...bounds,
      });
      return {
        segments: result.segments,
        requestedBy: roundToMs(op.by),
        appliedBy: result.applied,
      };
    }
  }
}

/** Gaps between consecutive segments (skipped source content). */
function segmentGaps(
  segments: CompositeSegment[]
): Array<{ afterIndex: number; seconds: number }> {
  const gaps: Array<{ afterIndex: number; seconds: number }> = [];
  for (let i = 0; i < segments.length - 1; i++) {
    const gap = roundToMs(segments[i + 1].start - segments[i].end);
    if (gap > 0) {
      gaps.push({ afterIndex: i, seconds: gap });
    }
  }
  return gaps;
}

async function requireMedia(
  pb: TypedPocketBase,
  clipId: string,
  mediaId: string
): Promise<Media> {
  const media = await new MediaMutator(pb).getById(mediaId);
  if (!media) {
    throw new Error(`Clip ${clipId} references missing media ${mediaId}.`);
  }
  return media;
}

export interface MediaClipSegmentsEditResult {
  /** The updated clip, or null when nothing was written (dry run / no-op). */
  clip: MediaClip | null;
  before: CompositeSegment[];
  after: CompositeSegment[];
  times: SegmentTimes;
  /** True when a plain clip was auto-converted to type 'composite'. */
  converted: boolean;
  requestedBy?: number;
  appliedBy?: number;
  dryRun: boolean;
}

/**
 * Apply a segment op to a MediaClip's edit list (`clipData.segments`).
 * Non-composite clips auto-convert: their trim window becomes the first
 * segment and the clip's type flips to 'composite'.
 */
export async function editMediaClipSegments(
  pb: TypedPocketBase,
  clipId: string,
  op: SegmentOp,
  opts: { dryRun?: boolean } = {}
): Promise<MediaClipSegmentsEditResult> {
  const mutator = new MediaClipMutator(pb);
  const clip = await mutator.getById(clipId);
  if (!clip) {
    throw new Error(`Media clip not found: ${clipId}`);
  }
  const media = await requireMedia(pb, clipId, clip.MediaRef);
  const bounds = mediaBounds(media);

  const existing = getCompositeSegments(clip);
  const converted = !existing || existing.length === 0;
  const before = normalizeSegments(
    converted ? [{ start: clip.start, end: clip.end }] : existing!,
    bounds
  );
  if (before.length === 0) {
    throw new Error(
      `Clip ${clipId} has no usable segments (range ${clip.start}–${clip.end}s).`
    );
  }

  const applied = applySegmentOp(before, op, bounds);
  const times = deriveClipTimes(applied.segments);
  const noop = op.kind === 'slip' && applied.appliedBy === 0;

  let updated: MediaClip | null = null;
  if (!opts.dryRun && !noop) {
    updated = await mutator.update(clipId, {
      ...(converted ? { type: ClipType.COMPOSITE } : {}),
      start: times.start,
      end: times.end,
      duration: times.duration,
      // merge, never replace: update() skips validation, so unknown keys
      // like gapThreshold survive — keep it that way
      clipData: { ...(clip.clipData ?? {}), segments: applied.segments },
    });
  }

  return {
    clip: updated,
    before,
    after: applied.segments,
    times,
    converted,
    ...(applied.requestedBy !== undefined
      ? { requestedBy: applied.requestedBy, appliedBy: applied.appliedBy }
      : {}),
    dryRun: !!opts.dryRun,
  };
}

export interface TimelineClipSegmentsEditResult {
  /** The updated clip, or null when nothing was written (dry run / no-op). */
  clip: TimelineClip | null;
  before: CompositeSegment[];
  after: CompositeSegment[];
  times: SegmentTimes;
  /** Where the edit list was initialized from (copy-on-write). */
  segmentsSource: TimelineEditListSource;
  /** Change in effective (render) duration, seconds. */
  effectiveDelta: number;
  /** Downstream shifts applied (or planned, on a dry run) with --ripple. */
  rippled: RippleShift[];
  requestedBy?: number;
  appliedBy?: number;
  dryRun: boolean;
}

/**
 * Apply a segment op to a TimelineClip's edit list (`meta.segments`,
 * copy-on-write — the clip stops following later edits to its source
 * MediaClip once it has its own list). With `ripple`, downstream clips on
 * the same lane shift by the effective-duration change so cut material
 * closes up (or extended material pushes them right).
 */
export async function editTimelineClipSegments(
  pb: TypedPocketBase,
  clipId: string,
  op: SegmentOp,
  opts: { ripple?: boolean; dryRun?: boolean; timelineId?: string } = {}
): Promise<TimelineClipSegmentsEditResult> {
  const clipMutator = new TimelineClipMutator(pb);
  const clip = await clipMutator.getById(clipId);
  if (!clip) {
    throw new Error(`Timeline clip not found: ${clipId}`);
  }
  assertOnTimeline(clip, opts.timelineId);
  if (!clip.MediaRef) {
    throw new Error(
      `Clip ${clipId} has no source media — segment edits apply to ` +
        `media-backed clips, not captions or nested timelines.`
    );
  }
  const media = await requireMedia(pb, clipId, clip.MediaRef);
  const bounds = mediaBounds(media);

  const editList = await resolveTimelineEditList(pb, clip);
  const before = normalizeSegments(editList.segments, bounds);
  if (before.length === 0) {
    throw new Error(
      `Clip ${clipId} has no usable segments (range ${clip.start}–${clip.end}s).`
    );
  }
  const oldEffective = calculateEffectiveDuration(clip.start, clip.end, before);

  const applied = applySegmentOp(before, op, bounds);
  const times = deriveClipTimes(applied.segments);
  const effectiveDelta = roundToMs(times.duration - oldEffective);
  const noop = op.kind === 'slip' && applied.appliedBy === 0;

  let rippled: RippleShift[] = [];
  if (opts.ripple && effectiveDelta !== 0 && !noop) {
    // Plan (and apply) downstream shifts from the lane as it is now — the
    // anchor's position doesn't change, only its effective length does.
    const ripple = await rippleDownstreamClips(pb, clip, effectiveDelta, {
      newEffectiveDuration: times.duration,
      dryRun: opts.dryRun,
    });
    rippled = ripple.shifted;
  }

  let updated: TimelineClip | null = null;
  if (!opts.dryRun && !noop) {
    updated = await clipMutator.update(clipId, {
      start: times.start,
      end: times.end,
      duration: times.duration,
      // merge, never replace — gain/title/color survive
      meta: { ...(clip.meta ?? {}), segments: applied.segments },
    });
    await syncTimelineDuration(pb, clip.TimelineRef);
  }

  return {
    clip: updated,
    before,
    after: applied.segments,
    times,
    segmentsSource: editList.source,
    effectiveDelta,
    rippled,
    ...(applied.requestedBy !== undefined
      ? { requestedBy: applied.requestedBy, appliedBy: applied.appliedBy }
      : {}),
    dryRun: !!opts.dryRun,
  };
}

export interface SegmentsInspection {
  segments: CompositeSegment[];
  times: SegmentTimes;
  /** 'clipData' = composite MediaClip; 'meta'/'mediaClip'/'trim' = timeline clip sources. */
  source: 'clipData' | TimelineEditListSource;
  gaps: Array<{ afterIndex: number; seconds: number }>;
  mediaId: string;
  mediaDuration: number;
}

/** Read-only view of a MediaClip's edit list for `media clip segments`. */
export async function inspectMediaClipSegments(
  pb: TypedPocketBase,
  clipId: string
): Promise<SegmentsInspection> {
  const clip = await new MediaClipMutator(pb).getById(clipId);
  if (!clip) {
    throw new Error(`Media clip not found: ${clipId}`);
  }
  const media = await requireMedia(pb, clipId, clip.MediaRef);
  const existing = getCompositeSegments(clip);
  const segments = normalizeSegments(
    existing?.length ? existing : [{ start: clip.start, end: clip.end }],
    mediaBounds(media)
  );
  return {
    segments,
    times: deriveClipTimes(segments),
    source: existing?.length ? 'clipData' : 'trim',
    gaps: segmentGaps(segments),
    mediaId: media.id,
    mediaDuration: media.duration,
  };
}

/** Read-only view of a TimelineClip's edit list for `timeline clips segments`. */
export async function inspectTimelineClipSegments(
  pb: TypedPocketBase,
  clipId: string,
  timelineId?: string
): Promise<SegmentsInspection> {
  const clip = await new TimelineClipMutator(pb).getById(clipId);
  if (!clip) {
    throw new Error(`Timeline clip not found: ${clipId}`);
  }
  assertOnTimeline(clip, timelineId);
  if (!clip.MediaRef) {
    throw new Error(
      `Clip ${clipId} has no source media — segment edits apply to ` +
        `media-backed clips, not captions or nested timelines.`
    );
  }
  const media = await requireMedia(pb, clipId, clip.MediaRef);
  const editList = await resolveTimelineEditList(pb, clip);
  const segments = normalizeSegments(editList.segments, mediaBounds(media));
  return {
    segments,
    times: deriveClipTimes(segments),
    source: editList.source,
    gaps: segmentGaps(segments),
    mediaId: media.id,
    mediaDuration: media.duration,
  };
}
