import type { TimelineTrack } from '@project/shared';

/**
 * Pure planning logic for the bounded multi-pass render (Tier 2).
 *
 * A long timeline rendered in one ffmpeg run opens every demuxer+decoder at
 * startup — hundreds of seeked per-segment inputs exhaust threads
 * (pthread_create EAGAIN) and then memory (each HEVC decoder holds
 * reference-frame buffers). The planner partitions the timeline into
 * contiguous time windows so each video pass opens a bounded number of
 * inputs; the parts are then losslessly concatenated. No NestJS deps — keep
 * this module pure so it stays trivially unit-testable.
 */

export interface RenderWindow {
  /** Window start on the timeline (seconds, inclusive). */
  start: number;
  /** Window end on the timeline (seconds, exclusive). */
  end: number;
  /** Video/image inputs overlapping the window (text/audio cost no input). */
  inputCount: number;
}

export interface WindowPlanOptions {
  /** Target window length in seconds (windows may cut earlier for the cap). */
  windowSec: number;
  /** Maximum video/image inputs a single pass may open. */
  maxInputsPerPass: number;
}

/** Millisecond rounding, matching the compose executor's fmtTime. */
const fmtTime = (t: number): number => Math.round(t * 1000) / 1000;

/**
 * Window cut points snap to 0.1s multiples: 0.1s is simultaneously ms-exact
 * (survives fmtTime) and on the 30fps frame grid (0.1 × 30 = 3 frames), so
 * per-part durations stay exact and no skew accumulates across concat joins.
 */
const snapToTenth = (t: number): number => Math.round(t * 10) / 10;

interface Interval {
  start: number;
  end: number;
}

/**
 * Video/image segments are the ones that cost an ffmpeg input (and thus a
 * decoder). Text segments render as drawtext filters and audio renders in
 * its own single full-timeline pass, so neither constrains window planning.
 */
function collectVisualIntervals(tracks: TimelineTrack[]): Interval[] {
  const intervals: Interval[] = [];
  for (const track of tracks) {
    if (track.type === 'audio') continue;
    for (const seg of track.segments) {
      if (seg.type === 'text' || !seg.assetId) continue;
      const start = fmtTime(seg.time.start);
      intervals.push({ start, end: fmtTime(start + seg.time.duration) });
    }
  }
  return intervals;
}

/**
 * Greedily partition [0, totalDuration] into contiguous windows. From each
 * window start, candidate cut points are the 0.1s-snapped visual segment
 * boundaries within the window reach plus the reach itself; the largest
 * candidate whose half-open overlap count stays within the input cap wins.
 * When even the smallest candidate exceeds the cap (clips stacked at one
 * instant — no time split can help), that smallest window is emitted anyway
 * with its true inputCount so the caller can warn.
 */
export function planRenderWindows(
  tracks: TimelineTrack[],
  totalDuration: number,
  opts: WindowPlanOptions
): RenderWindow[] {
  const total = fmtTime(totalDuration);
  if (total <= 0) return [];
  const windowSec = Math.max(opts.windowSec, 1);
  const maxInputsPerPass = Math.max(opts.maxInputsPerPass, 1);

  const intervals = collectVisualIntervals(tracks);
  const windows: RenderWindow[] = [];
  let t0 = 0;

  while (t0 < total) {
    // The final window ends at totalDuration unsnapped — nothing follows it.
    const reach = fmtTime(Math.min(t0 + windowSec, total));
    const candidates = new Set<number>([reach]);
    for (const interval of intervals) {
      for (const boundary of [interval.start, interval.end]) {
        const snapped = snapToTenth(boundary);
        if (snapped > t0 && snapped < reach) candidates.add(snapped);
      }
    }

    // Overlap count is monotonically non-decreasing in the window end, so a
    // single ascending scan finds the largest end still within the cap.
    const sorted = [...candidates].sort((a, b) => a - b);
    const overlapCount = (end: number) =>
      intervals.filter((s) => s.start < end && s.end > t0).length;

    let chosenEnd = sorted[0];
    let chosenCount = overlapCount(chosenEnd);
    for (let i = 1; i < sorted.length; i++) {
      const count = overlapCount(sorted[i]);
      if (count > maxInputsPerPass) break;
      chosenEnd = sorted[i];
      chosenCount = count;
    }

    windows.push({ start: t0, end: chosenEnd, inputCount: chosenCount });
    t0 = chosenEnd;
  }

  return windows;
}

/**
 * Project the timeline into a window's local coordinates for a video-only
 * pass. Audio tracks are dropped entirely (audio renders in one full-timeline
 * pass — splitting it at window joins would split the per-segment afades and
 * click). Video/image segments are clipped to the window: the seeked input
 * advances by the clipped-off head and the duration shrinks to the overlap.
 * Text segments are only SHIFTED, never clipped — drawtext's
 * enable='between(t,…)' simply doesn't draw outside [0, windowLen), so
 * shifting sidesteps the whole cue-splitting bug surface (start may go
 * negative for segments straddling the window start).
 */
export function clipTracksToWindow(
  tracks: TimelineTrack[],
  window: RenderWindow
): TimelineTrack[] {
  const t0 = window.start;
  const t1 = window.end;
  const clipped: TimelineTrack[] = [];

  for (const track of tracks) {
    if (track.type === 'audio') continue;
    const segments: TimelineTrack['segments'] = [];

    for (const seg of track.segments) {
      const segStart = fmtTime(seg.time.start);
      const segEnd = fmtTime(segStart + seg.time.duration);
      // Half-open overlap: a segment ending exactly at t0 belongs to the
      // previous window; one starting exactly at t1 belongs to the next.
      if (segStart >= t1 || segEnd <= t0) continue;

      if (seg.type === 'text') {
        segments.push({
          ...seg,
          time: { ...seg.time, start: fmtTime(segStart - t0) },
        });
        continue;
      }

      const overlapStart = Math.max(segStart, t0);
      const overlapEnd = Math.min(segEnd, t1);
      segments.push({
        ...seg,
        time: {
          ...seg.time,
          start: fmtTime(overlapStart - t0),
          duration: fmtTime(overlapEnd - overlapStart),
          sourceStart: fmtTime(
            (seg.time.sourceStart || 0) + (overlapStart - segStart)
          ),
        },
      });
    }

    if (segments.length > 0) {
      clipped.push({ ...track, segments });
    }
  }

  return clipped;
}
