import {
  ClipType,
  calculateEffectiveDuration,
  deriveClipTimes,
  normalizeSegments,
  type MediaClip,
} from '@project/shared';
import type { Segment } from '@/components/timeline/segment-editor';
import type { ExpandedTimelineClip } from '@/types/expanded-types';

/**
 * Pure builders for the clip editor's save payloads. Shared invariants (the
 * same ones the `vw` CLI enforces):
 *  - segments are persisted normalized (sorted, ms-rounded, overlap-free)
 *  - `start`/`end` span the segments; `duration` is the effective
 *    (gap-skipping) playback length, never `end - start`
 *  - `clipData`/`meta` are merged, never replaced, so unrelated keys
 *    (gapThreshold, gain, title, color, …) survive
 *  - a MediaClip gains `type: 'composite'` on its first segment edit
 */

/** Patch for saving a MediaClip's segment edit list (auto-converting). */
export function buildMediaClipSegmentsPatch(options: {
  clip: Pick<MediaClip, 'type' | 'clipData'>;
  segments: Segment[];
  mediaDuration: number;
  isImage?: boolean;
}): Record<string, unknown> {
  const { clip, segments, mediaDuration, isImage } = options;
  const normalized = normalizeSegments(
    segments,
    isImage ? {} : { mediaDuration }
  );
  const times = deriveClipTimes(normalized);
  return {
    ...(clip.type !== ClipType.COMPOSITE ? { type: ClipType.COMPOSITE } : {}),
    start: times.start,
    end: times.end,
    duration: times.duration,
    clipData: {
      ...(clip.clipData && typeof clip.clipData === 'object'
        ? clip.clipData
        : {}),
      segments: normalized,
    },
  };
}

/**
 * Updates for saving a TimelineClip (the `onSave` payload). Segment edits are
 * copy-on-write into `meta.segments`: the placed clip keeps its own edit list
 * and the source MediaClip is left untouched — so other placements of the
 * same clip keep playing the library version.
 *
 * Trims are non-destructive: `start`/`end` persist the whole-clip window and
 * the FULL edit list is kept, so a trimmed composite can always be expanded
 * back out. The render intersects the list with the window; `duration` is
 * the windowed effective (gap-skipping) length.
 */
export function buildTimelineClipUpdates(options: {
  clip: Pick<ExpandedTimelineClip, 'meta'>;
  /** Whole-clip trim window (windows the edit list for composites). */
  startTime: number;
  endTime: number;
  /** The full edit list; pass null/empty for plain (non-composite) clips. */
  segments: Segment[] | null;
  mediaDuration: number;
  isImage?: boolean;
  title: string;
  color: string;
  gain: number;
}): Record<string, unknown> {
  const {
    clip,
    startTime,
    endTime,
    segments,
    mediaDuration,
    isImage,
    title,
    color,
    gain,
  } = options;

  const baseMeta = {
    ...(typeof clip.meta === 'object' && clip.meta ? clip.meta : {}),
    title,
    color,
    gain,
  };

  if (segments && segments.length > 0) {
    const normalized = normalizeSegments(
      segments,
      isImage ? {} : { mediaDuration }
    );
    // Clamp the window to the list's span so stored times stay meaningful;
    // trims inside the span persist as-is (non-destructive window). A window
    // that misses the span entirely (blocked by editor validation) falls
    // back to the full span rather than persisting an inverted range.
    const span = deriveClipTimes(normalized);
    let start = Math.max(startTime, span.start);
    let end = Math.min(endTime, span.end);
    if (!(start < end)) {
      start = span.start;
      end = span.end;
    }
    return {
      start,
      end,
      // windowed effective duration keeps the timeline's optimistic
      // duration honest
      duration: calculateEffectiveDuration(start, end, normalized),
      meta: { ...baseMeta, segments: normalized },
    };
  }

  return {
    start: startTime,
    end: endTime,
    duration: endTime - startTime,
    meta: baseMeta,
  };
}
