import type { TimelineClip } from '../schema/timeline-clip.js';
import type { TimelineTrackRecord } from '../schema/timeline-track.js';
import {
  buildPlaybackTracks,
  clipPlaybackRegions,
  computeTimelineDuration,
  getClipTimelineDuration,
  regionSourceEnd,
  PLAYBACK_CONTINUITY_EPSILON,
  type PlacedClip,
} from './timeline-placement.js';

/**
 * Timeline health checks shared by the CLI (`vw timeline doctor`) and the
 * webapp editor (doctor modal + inline junction indicators). Everything here
 * is pure: callers load the clips/tracks however they like (PocketBase in the
 * CLI, the editor's in-memory state in the webapp) and get identical
 * findings, so the two doctors can never drift apart.
 */

/** Severity: errors violate data-model invariants, warnings self-heal. */
export type DoctorLevel = 'error' | 'warning' | 'info';

export type DoctorCode =
  | 'track-overlap'
  | 'dangling-media'
  | 'dangling-media-clip'
  | 'dangling-caption'
  | 'dangling-track'
  | 'duplicate-track-layer'
  | 'stale-timeline-duration'
  | 'stale-clip-duration'
  | 'nested-window-drift'
  | 'micro-gap'
  | 'track-gap';

export interface DoctorFinding {
  level: DoctorLevel;
  code: DoctorCode;
  message: string;
  clipIds: string[];
  /** Track layer the finding is scoped to, when track-scoped. */
  layer?: number;
  /** Timeline range the finding covers, when position-scoped (overlaps, gaps). */
  start?: number;
  end?: number;
}

/** Ranges closer than this (seconds) count as the same instant. */
export const TIMELINE_EPSILON = 1e-6;

/**
 * Gaps narrower than this (seconds) are almost always float drift or a
 * mis-drop rather than an intentional pause, so the doctor flags them as
 * warnings instead of the info-level note ordinary gaps get.
 */
export const MICRO_GAP_THRESHOLD = 0.1;

const LEVEL_ORDER: Record<DoctorLevel, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

const secs = (v: number) => `${v.toFixed(2)}s`;
const millis = (v: number) => `${Math.max(1, Math.round(v * 1000))}ms`;

export interface TimeRange {
  start: number;
  end: number;
}

/**
 * Groups of items whose time ranges overlap, in start order. An item joins
 * the current cluster when it starts before the cluster's furthest end;
 * single-item clusters are dropped (nothing overlaps them).
 */
export function clusterOverlappingRanges<T>(
  items: readonly T[],
  rangeOf: (item: T) => TimeRange
): T[][] {
  const sorted = [...items].sort((a, b) => rangeOf(a).start - rangeOf(b).start);
  const clusters: T[][] = [];
  let current: T[] = [];
  let currentEnd = -Infinity;

  for (const item of sorted) {
    const { start, end } = rangeOf(item);
    if (current.length > 0 && start < currentEnd - TIMELINE_EPSILON) {
      current.push(item);
      currentEnd = Math.max(currentEnd, end);
    } else {
      if (current.length > 1) clusters.push(current);
      current = [item];
      currentEnd = end;
    }
  }
  if (current.length > 1) clusters.push(current);
  return clusters;
}

/** A silent span between two consecutive items on a track. */
export interface RangeGap<T> {
  start: number;
  end: number;
  before: T;
  after: T;
}

/**
 * Gaps between consecutive time ranges (not before the first). `before` is
 * the item whose range reaches furthest, so an item nested inside a longer
 * one never fabricates a gap.
 */
export function findRangeGaps<T>(
  items: readonly T[],
  rangeOf: (item: T) => TimeRange
): RangeGap<T>[] {
  const sorted = [...items].sort((a, b) => rangeOf(a).start - rangeOf(b).start);
  const gaps: RangeGap<T>[] = [];
  let prev: T | null = null;

  for (const item of sorted) {
    const { start, end } = rangeOf(item);
    if (prev && start > rangeOf(prev).end + TIMELINE_EPSILON) {
      gaps.push({
        start: rangeOf(prev).end,
        end: start,
        before: prev,
        after: item,
      });
    }
    if (!prev || end > rangeOf(prev).end) {
      prev = item;
    }
  }
  return gaps;
}

/**
 * How two consecutive clips on a track meet:
 * - `continuous` — touching, and the source media carries straight across the
 *   seam (a pure split point: no content missing).
 * - `touching` — touching, but the content jumps (a hard cut).
 * - `micro-gap` — separated by a sliver narrower than the micro-gap
 *   threshold, which usually means a drag landed almost-but-not-quite flush.
 * Ordinary (wider) gaps and overlaps are not junctions; the doctor reports
 * them separately.
 */
export type TrackJunctionKind = 'continuous' | 'touching' | 'micro-gap';

export interface TrackJunction {
  kind: TrackJunctionKind;
  /** Timeline time of the seam (the earlier clip's end). */
  time: number;
  /** Gap width in seconds (0 for touching/continuous). */
  gap: number;
  beforeClipId: string;
  afterClipId: string;
}

/**
 * Whether the source media plays straight across the seam between two
 * touching clips: same media, and the second clip picks up (within playback
 * continuity tolerance) where the first one's last continuous region ends.
 */
function isContinuousJoin(before: PlacedClip, after: PlacedClip): boolean {
  if (!before.clip.MediaRef || before.clip.MediaRef !== after.clip.MediaRef) {
    return false;
  }
  const beforeRegions = clipPlaybackRegions(before);
  const afterRegions = clipPlaybackRegions(after);
  const outPoint = regionSourceEnd(beforeRegions[beforeRegions.length - 1]);
  const inPoint = afterRegions[0].sourceStart;
  return Math.abs(inPoint - outPoint) <= PLAYBACK_CONTINUITY_EPSILON;
}

/**
 * Classify the seams between consecutive placed clips on one track. Used by
 * the editor lanes to render junction indicators (touching vs. nearly
 * touching) and by the doctor's micro-gap check.
 */
export function analyzeTrackJunctions(
  placed: readonly PlacedClip[],
  microGapThreshold = MICRO_GAP_THRESHOLD
): TrackJunction[] {
  const sorted = [...placed].sort((a, b) => a.globalStart - b.globalStart);
  const junctions: TrackJunction[] = [];
  let prev: PlacedClip | null = null;

  for (const clip of sorted) {
    if (prev) {
      const gap = clip.globalStart - prev.globalEnd;
      if (Math.abs(gap) <= TIMELINE_EPSILON) {
        junctions.push({
          kind: isContinuousJoin(prev, clip) ? 'continuous' : 'touching',
          time: prev.globalEnd,
          gap: 0,
          beforeClipId: prev.clip.id,
          afterClipId: clip.clip.id,
        });
      } else if (gap > 0 && gap < microGapThreshold) {
        junctions.push({
          kind: 'micro-gap',
          time: prev.globalEnd,
          gap,
          beforeClipId: prev.clip.id,
          afterClipId: clip.clip.id,
        });
      }
    }
    if (!prev || clip.globalEnd > prev.globalEnd) {
      prev = clip;
    }
  }
  return junctions;
}

export interface TimelineDoctorInput {
  clips: TimelineClip[];
  tracks: TimelineTrackRecord[];
  /**
   * Stored Timeline.duration to check against the computed duration. Omit to
   * skip the check — the webapp does, because its local copy of the stored
   * duration goes stale the moment a clip edit persists (the server heals it
   * via hook, so flagging it there would be pure noise).
   */
  storedDuration?: number;
}

export interface TimelineDoctorOptions {
  /** Gaps narrower than this (seconds) are warned as micro-gaps. */
  microGapThreshold?: number;
}

type ClipWithExpand = TimelineClip & {
  expand?: {
    MediaRef?: unknown;
    MediaClipRef?: unknown;
    CaptionRef?: unknown;
  };
};

/**
 * Run the shared health checks over a timeline's clips: same-track overlaps
 * (invalid per the data model), micro-gaps and ordinary gaps, stale stored
 * durations, dangling references, and track-structure damage (duplicate
 * layers, clips pointing at deleted tracks). Findings come back in discovery
 * order (track structure; then per track: overlaps, gaps, per-clip checks;
 * then the timeline-level duration check) — pass them through
 * sortDoctorFindings for a most-severe-first report. Messages are neutral;
 * the CLI appends its remediation hints on top.
 */
export function collectTimelineDoctorFindings(
  input: TimelineDoctorInput,
  options: TimelineDoctorOptions = {}
): DoctorFinding[] {
  const microGapThreshold = options.microGapThreshold ?? MICRO_GAP_THRESHOLD;
  const findings: DoctorFinding[] = [];

  // Track-structure checks first: both states are produced by concurrent
  // editors racing (double-materialized default track, track deleted while a
  // clip still pointed at it) and both silently distort lane assignment.
  const byLayer = new Map<number, TimelineTrackRecord[]>();
  for (const track of input.tracks) {
    byLayer.set(track.layer, [...(byLayer.get(track.layer) ?? []), track]);
  }
  for (const [layer, tracks] of byLayer) {
    if (tracks.length > 1) {
      findings.push({
        level: 'error',
        code: 'duplicate-track-layer',
        layer,
        clipIds: [],
        message:
          `tracks ${tracks.map((t) => t.id).join(', ')} all have layer ` +
          `${layer} — layer addressing is ambiguous`,
      });
    }
  }

  const trackIds = new Set(input.tracks.map((t) => t.id));
  for (const clip of input.clips) {
    if (clip.TimelineTrackRef && !trackIds.has(clip.TimelineTrackRef)) {
      findings.push({
        level: 'error',
        code: 'dangling-track',
        clipIds: [clip.id],
        message:
          `clip ${clip.id} references missing track ` +
          `${clip.TimelineTrackRef} — it belongs to no lane and silently ` +
          'drops out of playback and rendering',
      });
    }
  }

  for (const track of buildPlaybackTracks(input.clips, input.tracks)) {
    const placed = [
      ...track.mediaClips,
      ...track.captionClips,
      ...track.timelineClips,
    ].sort((a, b) => a.globalStart - b.globalStart);
    const rangeOf = (p: PlacedClip) => ({
      start: p.globalStart,
      end: p.globalEnd,
    });

    for (const cluster of clusterOverlappingRanges(placed, rangeOf)) {
      const start = cluster[0].globalStart;
      const end = Math.max(...cluster.map((c) => c.globalEnd));
      findings.push({
        level: 'error',
        code: 'track-overlap',
        layer: track.layer,
        clipIds: cluster.map((c) => c.clip.id),
        start,
        end,
        message:
          `track ${track.layer}: ${cluster.length} clips overlap between ` +
          `${secs(start)} and ${secs(end)} — same-track overlaps are invalid`,
      });
    }

    for (const gap of findRangeGaps(placed, rangeOf)) {
      const width = gap.end - gap.start;
      const shared = {
        layer: track.layer,
        clipIds: [gap.before.clip.id, gap.after.clip.id],
        start: gap.start,
        end: gap.end,
      };
      if (width < microGapThreshold) {
        findings.push({
          level: 'warning',
          code: 'micro-gap',
          ...shared,
          message:
            `track ${track.layer}: ${millis(width)} micro-gap at ` +
            `${secs(gap.start)}–${secs(gap.end)} — clips are nearly ` +
            'touching; this is usually unintended',
        });
      } else {
        findings.push({
          level: 'info',
          code: 'track-gap',
          ...shared,
          message:
            `track ${track.layer}: ${secs(width)} gap at ` +
            `${secs(gap.start)}–${secs(gap.end)}`,
        });
      }
    }

    for (const placedClip of placed) {
      const clip = placedClip.clip as ClipWithExpand;
      // Stored duration must match the clip's *effective* on-timeline length
      // (composites legitimately store their gap-skipping segment sum, not
      // end − start).
      const effective = getClipTimelineDuration(clip);
      if (Math.abs(clip.duration - effective) > TIMELINE_EPSILON) {
        findings.push({
          level: 'warning',
          code: 'stale-clip-duration',
          layer: track.layer,
          clipIds: [clip.id],
          message:
            `clip ${clip.id}: stored duration ${secs(clip.duration)} ≠ ` +
            `effective duration (${secs(effective)})`,
        });
      }
      if (clip.MediaRef && !clip.expand?.MediaRef) {
        findings.push({
          level: 'error',
          code: 'dangling-media',
          layer: track.layer,
          clipIds: [clip.id],
          message:
            `clip ${clip.id} references missing media ${clip.MediaRef} — ` +
            'rendering will fail',
        });
      }
      if (clip.MediaClipRef && !clip.expand?.MediaClipRef) {
        findings.push({
          level: 'warning',
          code: 'dangling-media-clip',
          layer: track.layer,
          clipIds: [clip.id],
          message:
            `clip ${clip.id} references missing MediaClip ` +
            `${clip.MediaClipRef} (provenance only — playback and rendering ` +
            'are unaffected)',
        });
      }
      if (clip.CaptionRef && !clip.expand?.CaptionRef) {
        findings.push({
          level: 'error',
          code: 'dangling-caption',
          layer: track.layer,
          clipIds: [clip.id],
          message:
            `clip ${clip.id} references missing caption ${clip.CaptionRef} ` +
            '— rendering will fail',
        });
      }
    }
  }

  if (input.storedDuration !== undefined) {
    const computed = computeTimelineDuration(input.clips, input.tracks);
    if (Math.abs(input.storedDuration - computed) > TIMELINE_EPSILON) {
      findings.push({
        level: 'warning',
        code: 'stale-timeline-duration',
        clipIds: [],
        message:
          `stored duration ${secs(input.storedDuration)} ≠ computed ` +
          `${secs(computed)} — self-heals on the next clip mutation`,
      });
    }
  }

  return findings;
}

/** Findings sorted most severe first (stable within a level). */
export function sortDoctorFindings(findings: DoctorFinding[]): DoctorFinding[] {
  return [...findings].sort(
    (a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]
  );
}

export interface DoctorSummary {
  errors: number;
  warnings: number;
  infos: number;
  /** True when no error-level findings exist. */
  ok: boolean;
}

export function summarizeDoctorFindings(
  findings: readonly DoctorFinding[]
): DoctorSummary {
  const errors = findings.filter((f) => f.level === 'error').length;
  const warnings = findings.filter((f) => f.level === 'warning').length;
  return {
    errors,
    warnings,
    infos: findings.length - errors - warnings,
    ok: errors === 0,
  };
}
