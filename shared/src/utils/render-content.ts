/**
 * What a render payload actually contains.
 *
 * A timeline does not need media to be renderable: captions, titles and
 * lower-thirds draw straight onto the renderer's black base canvas, so a
 * text-only timeline is a complete deliverable (slate, title card, animated
 * caption reel). The only genuinely meaningless render is one where NOTHING
 * draws — no media, no text — or one with zero duration.
 *
 * Pure so the "is this renderable?" decision is unit-testable without a
 * PocketBase or an ffmpeg process; the worker's PREPARE step is the caller.
 */

import type { TimelineTrack, TimelineSegment } from '../types/task-contracts';

/**
 * Whether a text segment would put pixels on screen. Mirrors the compose
 * executor's drawtext gate: cues win when present, otherwise the static
 * `content`, and an empty string draws nothing.
 */
export function textSegmentDraws(seg: TimelineSegment): boolean {
  if (seg.type !== 'text') return false;
  const cues = seg.text?.cues;
  if (cues && cues.length > 0) {
    return cues.some((cue) => cue.text?.trim() && cue.end > cue.start);
  }
  return !!seg.text?.content?.trim();
}

export interface RenderContentSummary {
  /**
   * Every media id referenced by a segment, deduped. Zero-duration segments
   * are included on purpose — the compose graph still looks each asset up by
   * id before deciding to skip it.
   */
  mediaIds: string[];
  /** Text segments that would actually draw something. */
  drawableTextSegments: number;
  /** Furthest segment end, in seconds — the render's duration. */
  duration: number;
  /**
   * True when the render would produce something other than an empty black
   * clip: non-zero duration AND at least one media or drawable text segment.
   */
  hasContent: boolean;
}

/**
 * Summarize a render payload's tracks. Deliberately settings-agnostic:
 * `includeCaptions` / `includeSubtitles` can still gate text out at compose
 * time, and a caller that asks for a render with all its text switched off
 * gets the black slate it asked for rather than a hard failure.
 */
export function summarizeRenderContent(
  tracks: TimelineTrack[]
): RenderContentSummary {
  const mediaIds = new Set<string>();
  let drawableTextSegments = 0;
  let duration = 0;

  for (const track of tracks) {
    for (const seg of track.segments) {
      const end = seg.time.start + seg.time.duration;
      if (Number.isFinite(end) && end > duration) duration = end;

      if (seg.assetId) {
        mediaIds.add(seg.assetId);
        continue;
      }
      if (seg.time.duration > 0 && textSegmentDraws(seg)) {
        drawableTextSegments++;
      }
    }
  }

  return {
    mediaIds: [...mediaIds],
    drawableTextSegments,
    duration,
    hasContent: duration > 0 && (mediaIds.size > 0 || drawableTextSegments > 0),
  };
}
