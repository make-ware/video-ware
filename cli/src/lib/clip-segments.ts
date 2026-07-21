import {
  MediaClipMutator,
  MediaMutator,
  TIMELINE_EPSILON,
  TimelineClipMutator,
  calculateEffectiveDuration,
  cutSegments,
  deriveClipTimes,
  finalizeSegments,
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
import { mediaBounds, syncTimelineAfterWrite } from './timeline.js';
import {
  assertOnTimeline,
  resolveTimelineEditList,
  rippleDownstreamClips,
  type RippleShift,
  type TimelineClipExpanded,
  type TimelineEditListSource,
} from './timeline-clip.js';
import {
  clampedWarning,
  noopNotice,
  postWriteOverlapWarning,
  shiftedOthersNotice,
  type OpWarning,
} from './warnings.js';

/**
 * Segment-level edit operations (split/cut/trim/slip/clear) shared by
 * `vw media clip …` and `vw timeline clips …` — fine-tuning dialogue by
 * editing a clip's edit list instead of creating standalone clips.
 *
 * All times are source-media seconds. Composite-ness is non-destructive: the
 * edit list itself is the only marker (>= 2 segments — hasActiveEditList),
 * and a clip's `type` stays its origin, untouched by segment edits. A clip
 * with no edit list gets one on its first edit: MediaClips in
 * `clipData.segments`, TimelineClips as a copy-on-write `meta.segments`
 * (initialized from the referenced composite MediaClip when present, else
 * the clip's own trim window). Every write finalizes through
 * finalizeSegments: `start`/`end`/`duration` are derived from the resulting
 * list (`duration` is the effective gap-skipping length), and an edit that
 * leaves a single segment collapses the list — start/end become the source
 * of truth again (the auto-revert). The one exception is a TimelineClip
 * whose source MediaClip has its own edit list: its single-segment override
 * is kept, since unsetting it would unmask the source's cuts.
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

/**
 * Whether an op left the edit list unchanged (within epsilon) — the
 * generalized no-op check: a slip clamped to zero, a split at an existing
 * boundary, a trim to the same edges. No-ops skip the write entirely so
 * `updated` keeps meaning "content changed".
 */
function segmentsEqual(a: CompositeSegment[], b: CompositeSegment[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (seg, i) =>
        Math.abs(seg.start - b[i].start) <= TIMELINE_EPSILON &&
        Math.abs(seg.end - b[i].end) <= TIMELINE_EPSILON
    )
  );
}

const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}s`;

/** No-op / clamp warnings shared by both domains' edit paths. */
function segmentEditWarnings(
  clipId: string,
  op: SegmentOp,
  applied: AppliedOp,
  noop: boolean
): OpWarning[] {
  if (noop) {
    const message =
      op.kind === 'slip'
        ? 'nothing to slip — the segment is already flush against its ' +
          `bounds (requested ${signed(applied.requestedBy ?? 0)})`
        : 'the edit leaves the edit list unchanged — nothing to write';
    return [noopNotice(message, [clipId])];
  }
  if (
    op.kind === 'slip' &&
    applied.requestedBy !== undefined &&
    applied.appliedBy !== undefined &&
    applied.appliedBy !== applied.requestedBy
  ) {
    return [
      clampedWarning(
        applied.requestedBy,
        applied.appliedBy,
        'by media bounds/neighbors',
        [clipId]
      ),
    ];
  }
  return [];
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
  /** True when the clip had no edit list before this edit (list created). */
  converted: boolean;
  /**
   * True when the edit left a single segment, so the list was removed and
   * `start`/`end` are the source of truth again (auto-revert).
   */
  collapsed: boolean;
  /** True when the op left the edit list unchanged; nothing was written. */
  noop: boolean;
  requestedBy?: number;
  appliedBy?: number;
  dryRun: boolean;
  /** Soft outcomes: clamps, no-ops. */
  warnings: OpWarning[];
}

/**
 * Apply a segment op to a MediaClip's edit list (`clipData.segments`).
 * Non-destructive: the clip's `type` (its origin) is never touched. A clip
 * with no edit list gets one seeded from its trim window; an edit that
 * leaves a single segment collapses the list back into `start`/`end`.
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
  const before = normalizeSegments(
    existing ?? [{ start: clip.start, end: clip.end }],
    bounds
  );
  if (before.length === 0) {
    throw new Error(
      `Clip ${clipId} has no usable segments (range ${clip.start}–${clip.end}s).`
    );
  }

  const applied = applySegmentOp(before, op, bounds);
  const finalized = finalizeSegments(applied.segments, bounds);
  const times = {
    start: finalized.start,
    end: finalized.end,
    duration: finalized.duration,
  };
  // A plain clip's edit that leaves one segment (e.g. trimming its window)
  // never materializes a list — it stays a plain clip with new start/end.
  const converted = !existing && finalized.segments !== undefined;
  const collapsed = !!existing && finalized.segments === undefined;
  const noop = segmentsEqual(before, applied.segments);
  const warnings = segmentEditWarnings(clipId, op, applied, noop);

  let updated: MediaClip | null = null;
  if (!opts.dryRun && !noop) {
    // merge, never replace: update() skips validation, so unknown keys
    // like gapThreshold survive — keep it that way. clipData is one JSON
    // column replaced whole, so a collapsed list is removed by omission.
    const clipData: Record<string, unknown> = { ...(clip.clipData ?? {}) };
    if (finalized.segments) {
      clipData.segments = finalized.segments;
    } else {
      delete clipData.segments;
    }
    // Guarded write: a concurrent editor's clipData/trim change must not be
    // silently clobbered.
    updated = await mutator.updateWithGuard(
      clipId,
      {
        start: times.start,
        end: times.end,
        duration: times.duration,
        clipData,
      },
      { expectedUpdated: clip.updated, snapshot: clip }
    );
  }

  return {
    clip: updated,
    before,
    after: finalized.segments ?? [{ start: times.start, end: times.end }],
    times,
    converted,
    collapsed,
    noop,
    ...(applied.requestedBy !== undefined
      ? { requestedBy: applied.requestedBy, appliedBy: applied.appliedBy }
      : {}),
    dryRun: !!opts.dryRun,
    warnings,
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
  /**
   * True when the edit left a single segment and the `meta.segments`
   * override was removed — start/end are the source of truth again. Stays
   * false when the source MediaClip has its own edit list: the 1-segment
   * override is kept as a mask (unsetting it would unmask the source cuts).
   */
  collapsed: boolean;
  /**
   * Whether the clip carries its own `meta.segments` after this edit (a
   * plain clip's edit that leaves one segment never materializes one).
   */
  hasOwnEditList: boolean;
  /** Change in effective (render) duration, seconds. */
  effectiveDelta: number;
  /** Downstream shifts applied (or planned, on a dry run) with --ripple. */
  rippled: RippleShift[];
  /** True when the op left the edit list unchanged; nothing was written. */
  noop: boolean;
  requestedBy?: number;
  appliedBy?: number;
  dryRun: boolean;
  /** Soft outcomes: clamps, shifts, no-ops, concurrent-edit checks. */
  warnings: OpWarning[];
}

/**
 * Whether a timeline clip's source MediaClip carries its own (active) edit
 * list — the mask check for collapsing a 1-segment `meta.segments` override.
 */
async function sourceMediaClipHasEditList(
  pb: TypedPocketBase,
  clip: TimelineClip
): Promise<boolean> {
  if (!clip.MediaClipRef) return false;
  const mediaClip =
    (clip as TimelineClipExpanded).expand?.MediaClipRef ??
    (await new MediaClipMutator(pb).getById(clip.MediaClipRef)) ??
    undefined;
  return !!getCompositeSegments(mediaClip);
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
  const finalized = finalizeSegments(applied.segments, bounds);
  const times = {
    start: finalized.start,
    end: finalized.end,
    duration: finalized.duration,
  };
  // A 1-segment result collapses the override only when the source MediaClip
  // has no edit list of its own; otherwise it must stay as a mask.
  let segmentsToStore = finalized.segments;
  if (!segmentsToStore && (await sourceMediaClipHasEditList(pb, clip))) {
    segmentsToStore = [{ start: finalized.start, end: finalized.end }];
  }
  const hadOverride = !!clip.meta?.segments?.length;
  const collapsed = hadOverride && segmentsToStore === undefined;
  const effectiveDelta = roundToMs(times.duration - oldEffective);
  const noop = segmentsEqual(before, applied.segments);
  const warnings = segmentEditWarnings(clipId, op, applied, noop);

  let rippled: RippleShift[] = [];
  if (opts.ripple && effectiveDelta !== 0 && !noop) {
    // Plan (and apply) downstream shifts from the lane as it is now — the
    // anchor's position doesn't change, only its effective length does.
    const ripple = await rippleDownstreamClips(pb, clip, effectiveDelta, {
      newEffectiveDuration: times.duration,
      dryRun: opts.dryRun,
    });
    rippled = ripple.shifted;
    if (ripple.downstreamCount > 0 && ripple.by !== ripple.requestedBy) {
      warnings.push(
        clampedWarning(
          ripple.requestedBy,
          ripple.by,
          'so downstream clips stay clear of the anchor',
          rippled.map((s) => s.clipId)
        )
      );
    }
    if (rippled.length > 0) {
      warnings.push(
        shiftedOthersNotice(
          `--ripple shifted ${rippled.length} downstream clip(s) by ` +
            `${signed(ripple.by)}`,
          rippled.map((s) => s.clipId)
        )
      );
    }
  }

  let updated: TimelineClip | null = null;
  if (!opts.dryRun && !noop) {
    // merge, never replace — gain/title/color survive. meta is one JSON
    // column replaced whole, so a collapsed override is removed by omission.
    const meta: Record<string, unknown> = { ...(clip.meta ?? {}) };
    if (segmentsToStore) {
      meta.segments = segmentsToStore;
    } else {
      delete meta.segments;
    }
    // Guarded write: a concurrent gain/title edit must not be silently
    // dropped by this write.
    updated = await clipMutator.updateWithGuard(
      clipId,
      {
        start: times.start,
        end: times.end,
        duration: times.duration,
        meta,
      },
      { expectedUpdated: clip.updated, snapshot: clip }
    );
    const check = await syncTimelineAfterWrite(pb, clip.TimelineRef, [
      clipId,
      ...rippled.map((s) => s.clipId),
    ]);
    warnings.push(
      ...check.conflicts.map((f) =>
        postWriteOverlapWarning(f, clip.TimelineRef)
      )
    );
  }

  return {
    clip: updated,
    before,
    after: segmentsToStore ?? [{ start: times.start, end: times.end }],
    times,
    segmentsSource: editList.source,
    collapsed,
    hasOwnEditList: segmentsToStore !== undefined,
    effectiveDelta,
    rippled,
    noop,
    ...(applied.requestedBy !== undefined
      ? { requestedBy: applied.requestedBy, appliedBy: applied.appliedBy }
      : {}),
    dryRun: !!opts.dryRun,
    warnings,
  };
}

export interface MediaClipSegmentsClearResult {
  /** The updated clip, or null when nothing was written (dry run / no-op). */
  clip: MediaClip | null;
  /** The edit list that was removed (null when there was none). */
  removed: CompositeSegment[] | null;
  /** The plain trim the clip reverts to. */
  times: SegmentTimes;
  noop: boolean;
  dryRun: boolean;
  warnings: OpWarning[];
}

/**
 * Remove a MediaClip's edit list — the explicit revert. The clip keeps its
 * current [start, end] window (which always spans the list, so nothing
 * shifts); duration becomes the plain `end - start` again.
 */
export async function clearMediaClipSegments(
  pb: TypedPocketBase,
  clipId: string,
  opts: { dryRun?: boolean } = {}
): Promise<MediaClipSegmentsClearResult> {
  const mutator = new MediaClipMutator(pb);
  const clip = await mutator.getById(clipId);
  if (!clip) {
    throw new Error(`Media clip not found: ${clipId}`);
  }
  const existing = getCompositeSegments(clip);
  const times = {
    start: clip.start,
    end: clip.end,
    duration: roundToMs(clip.end - clip.start),
  };
  if (!existing) {
    return {
      clip: null,
      removed: null,
      times,
      noop: true,
      dryRun: !!opts.dryRun,
      warnings: [
        noopNotice('the clip has no edit list — nothing to clear', [clipId]),
      ],
    };
  }

  let updated: MediaClip | null = null;
  if (!opts.dryRun) {
    const clipData: Record<string, unknown> = { ...(clip.clipData ?? {}) };
    delete clipData.segments;
    updated = await mutator.updateWithGuard(
      clipId,
      {
        start: times.start,
        end: times.end,
        duration: times.duration,
        clipData,
      },
      { expectedUpdated: clip.updated, snapshot: clip }
    );
  }

  return {
    clip: updated,
    removed: existing,
    times,
    noop: false,
    dryRun: !!opts.dryRun,
    warnings: [],
  };
}

export interface TimelineClipSegmentsClearResult {
  /** The updated clip, or null when nothing was written (dry run / no-op). */
  clip: TimelineClip | null;
  /** The `meta.segments` override that was removed (null when none). */
  removed: CompositeSegment[] | null;
  times: SegmentTimes;
  /**
   * What governs playback after the clear: the source MediaClip's own edit
   * list ('mediaClip') or the plain [start, end] trim window ('trim').
   */
  revertsTo: 'mediaClip' | 'trim';
  /** Change in effective (render) duration, seconds. */
  effectiveDelta: number;
  /** Downstream shifts applied (or planned, on a dry run) with --ripple. */
  rippled: RippleShift[];
  noop: boolean;
  dryRun: boolean;
  warnings: OpWarning[];
}

/**
 * Remove a TimelineClip's `meta.segments` override — the explicit revert for
 * a placement. The clip keeps its [start, end] window; playback falls back
 * to the source MediaClip's own edit list when it has one (the natural
 * copy-on-write precedence), else to the plain window.
 */
export async function clearTimelineClipSegments(
  pb: TypedPocketBase,
  clipId: string,
  opts: { ripple?: boolean; dryRun?: boolean; timelineId?: string } = {}
): Promise<TimelineClipSegmentsClearResult> {
  const clipMutator = new TimelineClipMutator(pb);
  const clip = await clipMutator.getById(clipId);
  if (!clip) {
    throw new Error(`Timeline clip not found: ${clipId}`);
  }
  assertOnTimeline(clip, opts.timelineId);

  const existing = clip.meta?.segments;
  const sourceSegments = clip.MediaClipRef
    ? await (async () => {
        const mediaClip =
          (clip as TimelineClipExpanded).expand?.MediaClipRef ??
          (await new MediaClipMutator(pb).getById(clip.MediaClipRef!)) ??
          undefined;
        return getCompositeSegments(mediaClip);
      })()
    : undefined;
  const revertsTo = sourceSegments ? ('mediaClip' as const) : ('trim' as const);
  const newDuration = roundToMs(
    calculateEffectiveDuration(clip.start, clip.end, sourceSegments)
  );
  const times = { start: clip.start, end: clip.end, duration: newDuration };

  if (!existing || existing.length === 0) {
    return {
      clip: null,
      removed: null,
      times,
      revertsTo,
      effectiveDelta: 0,
      rippled: [],
      noop: true,
      dryRun: !!opts.dryRun,
      warnings: [
        noopNotice('the clip has no edit list override — nothing to clear', [
          clipId,
        ]),
      ],
    };
  }

  const oldEffective = calculateEffectiveDuration(
    clip.start,
    clip.end,
    existing
  );
  const effectiveDelta = roundToMs(newDuration - oldEffective);
  const warnings: OpWarning[] = [];

  let rippled: RippleShift[] = [];
  if (opts.ripple && effectiveDelta !== 0) {
    const ripple = await rippleDownstreamClips(pb, clip, effectiveDelta, {
      newEffectiveDuration: newDuration,
      dryRun: opts.dryRun,
    });
    rippled = ripple.shifted;
    if (ripple.downstreamCount > 0 && ripple.by !== ripple.requestedBy) {
      warnings.push(
        clampedWarning(
          ripple.requestedBy,
          ripple.by,
          'so downstream clips stay clear of the anchor',
          rippled.map((s) => s.clipId)
        )
      );
    }
    if (rippled.length > 0) {
      warnings.push(
        shiftedOthersNotice(
          `--ripple shifted ${rippled.length} downstream clip(s) by ` +
            `${signed(ripple.by)}`,
          rippled.map((s) => s.clipId)
        )
      );
    }
  }

  let updated: TimelineClip | null = null;
  if (!opts.dryRun) {
    const meta: Record<string, unknown> = { ...(clip.meta ?? {}) };
    delete meta.segments;
    updated = await clipMutator.updateWithGuard(
      clipId,
      { start: times.start, end: times.end, duration: times.duration, meta },
      { expectedUpdated: clip.updated, snapshot: clip }
    );
    const check = await syncTimelineAfterWrite(pb, clip.TimelineRef, [
      clipId,
      ...rippled.map((s) => s.clipId),
    ]);
    warnings.push(
      ...check.conflicts.map((f) =>
        postWriteOverlapWarning(f, clip.TimelineRef)
      )
    );
  }

  return {
    clip: updated,
    removed: existing,
    times,
    revertsTo,
    effectiveDelta,
    rippled,
    noop: false,
    dryRun: !!opts.dryRun,
    warnings,
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
