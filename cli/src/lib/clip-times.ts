import {
  calculateEffectiveDuration,
  getClipTimelineDuration,
  getCompositeSegments,
  roundToMs,
  type CompositeSegment,
  type MediaClip,
  type TimelineClip,
} from '@project/shared';
import type {
  TimelineClipExpanded,
  TimelineEditListSource,
} from './timeline-clip.js';

/**
 * The canonical `times` block: one JSON shape for clip time semantics across
 * every command that shows a clip (`clips show/list`, `timeline show/inspect`,
 * `media clip list`, `segments`). It names the three time domains explicitly
 * so agents never conflate them:
 *
 * - **timeline** — absolute seconds on the timeline (placed clips only).
 * - **effective** — the gap-skipping playback length; what the clip occupies
 *   on a timeline. Equals `timeline.duration` when placed.
 * - **source** — the trim window in source-media seconds (for caption clips:
 *   the caption's own cue axis; for nested-timeline clips: the child
 *   timeline's axis). `span = end - start` — the outer coverage, which for a
 *   composite is larger than the effective duration.
 */

/** Where a clip's edit list lives ('clipData' = library MediaClip field). */
export type EditListSource = TimelineEditListSource | 'clipData';

export interface ClipTimes {
  /** Placed position on the timeline; absent when placement is unknown. */
  timeline?: { start: number; end: number; duration: number };
  /** The clip's trim window (source seconds); span = end - start. */
  source: { start: number; end: number; span: number };
  /** Gap-skipping playback length — what the clip occupies on a timeline. */
  effective: { duration: number };
  /**
   * Stored edit-list summary; omitted for caption and nested-timeline clips
   * (their windows are already linear). count 1 + source 'meta' = a mask
   * over a composite source MediaClip; source 'trim' = no list at all.
   */
  segments?: { count: number; source: EditListSource };
  /** True iff an edit list with >= 2 segments governs playback. */
  composite: boolean;
}

/**
 * Synchronous core of resolveTimelineEditList: the edit list a timeline clip
 * renders with, using only the mutator's default MediaClipRef expansion
 * (meta.segments override >= 1 wins; expanded composite MediaClip >= 2 next;
 * else the trim window). Callers that may hold an unexpanded MediaClipRef
 * must use resolveTimelineEditList, which adds the fetch fallback.
 */
export function timelineEditListOf(clip: TimelineClip): {
  segments: CompositeSegment[];
  source: TimelineEditListSource;
} {
  const metaSegments = clip.meta?.segments;
  if (metaSegments && metaSegments.length > 0) {
    return { segments: metaSegments, source: 'meta' };
  }
  const mediaClip = (clip as TimelineClipExpanded).expand?.MediaClipRef;
  const segments = getCompositeSegments(mediaClip);
  if (segments && segments.length > 0) {
    return { segments, source: 'mediaClip' };
  }
  return { segments: [{ start: clip.start, end: clip.end }], source: 'trim' };
}

const round = (v: number) => roundToMs(v);

function sourceWindowOf(clip: {
  start: number;
  end: number;
}): ClipTimes['source'] {
  return {
    start: round(clip.start),
    end: round(clip.end),
    span: round(clip.end - clip.start),
  };
}

/**
 * Canonical times for a timeline clip. Relies on the mutator's default
 * MediaClipRef expansion (like getClipSegments); pass `placement` when the
 * clip's computed position is known to include the timeline domain.
 */
export function timelineClipTimes(
  clip: TimelineClip,
  placement?: { timelineStart: number; timelineEnd: number }
): ClipTimes {
  const times: ClipTimes = {
    source: sourceWindowOf(clip),
    effective: { duration: round(getClipTimelineDuration(clip)) },
    composite: false,
  };
  if (placement) {
    times.timeline = {
      start: round(placement.timelineStart),
      end: round(placement.timelineEnd),
      duration: round(placement.timelineEnd - placement.timelineStart),
    };
  }
  // Caption and nested-timeline windows are already linear — no edit list.
  if (!clip.CaptionRef && !clip.SourceTimelineRef) {
    const editList = timelineEditListOf(clip);
    times.segments = {
      count: editList.segments.length,
      source: editList.source,
    };
    times.composite = editList.segments.length >= 2;
  }
  return times;
}

/** Canonical times for a library MediaClip (no timeline domain). */
export function mediaClipTimes(clip: MediaClip): ClipTimes {
  const segments = getCompositeSegments(clip);
  return {
    source: sourceWindowOf(clip),
    effective: {
      duration: round(
        calculateEffectiveDuration(clip.start, clip.end, segments)
      ),
    },
    segments: segments
      ? { count: segments.length, source: 'clipData' }
      : { count: 1, source: 'trim' },
    composite: (segments?.length ?? 0) >= 2,
  };
}

/**
 * Table-cell suffix marking a composite clip (" ◆4" = 4-segment edit list),
 * empty for everything else. Appended to SOURCE/DURATION cells so a span
 * range is never mistaken for the clip's playback length.
 */
export function compositeMarker(times: ClipTimes): string {
  return times.composite ? ` ◆${times.segments?.count ?? 0}` : '';
}
