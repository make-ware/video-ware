import {
  calculateEffectiveDuration,
  finalizeSegments,
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
 *  - composite-ness is non-destructive: `type` is never touched, and an edit
 *    that leaves a single segment collapses the list (finalizeSegments) —
 *    `start`/`end` become the source of truth again
 */

/** Patch for saving a MediaClip's segment edit list. */
export function buildMediaClipSegmentsPatch(options: {
  clip: Pick<MediaClip, 'clipData'>;
  segments: Segment[];
  mediaDuration: number;
  isImage?: boolean;
}): Record<string, unknown> {
  const { clip, segments, mediaDuration, isImage } = options;
  const finalized = finalizeSegments(
    segments,
    isImage ? {} : { mediaDuration }
  );
  const clipData: Record<string, unknown> = {
    ...(clip.clipData && typeof clip.clipData === 'object'
      ? clip.clipData
      : {}),
  };
  if (finalized.segments) {
    clipData.segments = finalized.segments;
  } else {
    delete clipData.segments;
  }
  return {
    start: finalized.start,
    end: finalized.end,
    duration: finalized.duration,
    clipData,
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
 *
 * An edit that leaves a single segment collapses the override — unless the
 * source MediaClip has its own edit list (`sourceHasActiveEditList`): then
 * the 1-segment override is kept as a mask, since removing it would unmask
 * the source's cuts.
 */
export function buildTimelineClipUpdates(options: {
  clip: Pick<ExpandedTimelineClip, 'meta'>;
  /** Whole-clip trim window (windows the edit list for composites). */
  startTime: number;
  endTime: number;
  /** The full edit list; pass null/empty for plain (non-composite) clips. */
  segments: Segment[] | null;
  /** Whether the source MediaClip carries an active edit list of its own. */
  sourceHasActiveEditList?: boolean;
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
    sourceHasActiveEditList,
    mediaDuration,
    isImage,
    title,
    color,
    gain,
  } = options;

  const baseMeta: Record<string, unknown> = {
    ...(typeof clip.meta === 'object' && clip.meta ? clip.meta : {}),
    title,
    color,
    gain,
  };

  if (segments && segments.length > 0) {
    const finalized = finalizeSegments(
      segments,
      isImage ? {} : { mediaDuration }
    );
    const toStore =
      finalized.segments ??
      // 1-segment mask over a composite source: keep the override
      (sourceHasActiveEditList
        ? [{ start: finalized.start, end: finalized.end }]
        : undefined);

    if (toStore) {
      // Clamp the window to the list's span so stored times stay meaningful;
      // trims inside the span persist as-is (non-destructive window). A
      // window that misses the span entirely (blocked by editor validation)
      // falls back to the full span rather than persisting an inverted range.
      let start = Math.max(startTime, finalized.start);
      let end = Math.min(endTime, finalized.end);
      if (!(start < end)) {
        start = finalized.start;
        end = finalized.end;
      }
      return {
        start,
        end,
        // windowed effective duration keeps the timeline's optimistic
        // duration honest
        duration: calculateEffectiveDuration(start, end, toStore),
        meta: { ...baseMeta, segments: toStore },
      };
    }

    // Collapsed: the clip is plain again; the window intersects the sole
    // segment (start/end are the source of truth).
    let start = Math.max(startTime, finalized.start);
    let end = Math.min(endTime, finalized.end);
    if (!(start < end)) {
      start = finalized.start;
      end = finalized.end;
    }
    delete baseMeta.segments;
    return { start, end, duration: end - start, meta: baseMeta };
  }

  // Plain clip: never retain a stale segments key from the spread meta.
  delete baseMeta.segments;
  return {
    start: startTime,
    end: endTime,
    duration: endTime - startTime,
    meta: baseMeta,
  };
}
