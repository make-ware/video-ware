import type { TypedPocketBase } from '@project/shared';
import {
  getTimelineOverview,
  overlapClusters,
  trackGaps,
} from './timeline-inspect.js';
import { planTimelineReflow } from './timeline-reflow.js';

/**
 * `timeline doctor`: verifiable health checks over a timeline's placed
 * clips, so an agent (or human) can confirm a batch of edits left the
 * timeline consistent instead of eyeballing `timeline show` output.
 */

/** Severity: errors violate data-model invariants, warnings self-heal. */
export type DoctorLevel = 'error' | 'warning' | 'info';

export type DoctorCode =
  | 'track-overlap'
  | 'dangling-media'
  | 'dangling-media-clip'
  | 'dangling-caption'
  | 'stale-timeline-duration'
  | 'stale-clip-duration'
  | 'nested-window-drift'
  | 'track-gap';

export interface DoctorFinding {
  level: DoctorLevel;
  code: DoctorCode;
  message: string;
  clipIds: string[];
  /** Track layer the finding is scoped to, when track-scoped. */
  layer?: number;
}

export interface DoctorReport {
  timelineId: string;
  timelineName: string;
  computedDuration: number;
  clipCount: number;
  trackCount: number;
  /** Sorted most severe first. */
  findings: DoctorFinding[];
  errors: number;
  warnings: number;
  /** True when no error-level findings exist. */
  ok: boolean;
}

const secs = (v: number) => `${v.toFixed(2)}s`;
const EPSILON = 1e-6;
const LEVEL_ORDER: Record<DoctorLevel, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/**
 * Check a timeline for same-track overlaps (invalid per the data model),
 * dangling references, stale stored durations, and gaps between clips.
 */
export async function doctorTimeline(
  pb: TypedPocketBase,
  timelineId: string
): Promise<DoctorReport> {
  const overview = await getTimelineOverview(pb, timelineId);
  const findings: DoctorFinding[] = [];

  for (const track of overview.tracks) {
    for (const cluster of overlapClusters(track.clips)) {
      const start = cluster[0].timelineStart;
      const end = Math.max(...cluster.map((c) => c.timelineEnd));
      findings.push({
        level: 'error',
        code: 'track-overlap',
        layer: track.layer,
        clipIds: cluster.map((c) => c.clip.id),
        message:
          `track ${track.layer}: ${cluster.length} clips overlap between ` +
          `${secs(start)} and ${secs(end)} — same-track overlaps are ` +
          'invalid; reposition with `vw timeline clips move <id> --at <s>`',
      });
    }

    for (const gap of trackGaps(track.clips)) {
      const width = gap.end - gap.start;
      findings.push({
        level: 'info',
        code: 'track-gap',
        layer: track.layer,
        clipIds: [gap.beforeClipId, gap.afterClipId],
        message:
          `track ${track.layer}: ${secs(width)} gap at ` +
          `${secs(gap.start)}–${secs(gap.end)} (if unintended, close it ` +
          `with \`vw timeline clips ripple ${gap.afterClipId} --by=-${width.toFixed(2)}\`)`,
      });
    }

    for (const placed of track.clips) {
      const clip = placed.clip;
      const span = clip.end - clip.start;
      if (Math.abs(clip.duration - span) > EPSILON) {
        findings.push({
          level: 'warning',
          code: 'stale-clip-duration',
          layer: track.layer,
          clipIds: [clip.id],
          message:
            `clip ${clip.id}: stored duration ${secs(clip.duration)} ≠ ` +
            `end − start (${secs(span)}) — refresh with ` +
            '`vw timeline clips update` re-trimming the clip',
        });
      }
      if (clip.MediaRef && !clip.expand?.MediaRef) {
        findings.push({
          level: 'error',
          code: 'dangling-media',
          layer: track.layer,
          clipIds: [clip.id],
          message: `clip ${clip.id} references missing media ${clip.MediaRef} — rendering will fail; remove the clip or restore the media`,
        });
      }
      if (clip.MediaClipRef && !clip.expand?.MediaClipRef) {
        findings.push({
          level: 'warning',
          code: 'dangling-media-clip',
          layer: track.layer,
          clipIds: [clip.id],
          message: `clip ${clip.id} references missing MediaClip ${clip.MediaClipRef} (provenance only — playback and rendering are unaffected)`,
        });
      }
      if (clip.CaptionRef && !clip.expand?.CaptionRef) {
        findings.push({
          level: 'error',
          code: 'dangling-caption',
          layer: track.layer,
          clipIds: [clip.id],
          message: `clip ${clip.id} references missing caption ${clip.CaptionRef} — rendering will fail; remove the clip or restore the caption`,
        });
      }
    }
  }

  // Nested-timeline clip windows drift when their source timelines grow or
  // shrink after insert; the webapp heals this in memory on load/render and
  // persists a timeline's own clips on save. Only window/duration changes
  // count as drift — position-only shifts are covered by their own findings.
  // Reuse the root clips/tracks already loaded above; reflow fetches only the
  // nested tree the overview didn't carry.
  const reflow = await planTimelineReflow(
    pb,
    timelineId,
    overview.clips,
    overview.trackRecords
  );
  for (const plan of reflow.plans) {
    const drifted = plan.changes.filter(
      (c) =>
        c.start !== undefined || c.end !== undefined || c.duration !== undefined
    );
    if (drifted.length === 0) continue;
    const scope =
      plan.timelineId === timelineId
        ? 'timeline'
        : `nested timeline ${plan.timelineId}`;
    findings.push({
      level: 'warning',
      code: 'nested-window-drift',
      clipIds: drifted.map((c) => c.clipId),
      message:
        `${scope}: ${drifted.length} clip(s) drifted from their ` +
        'source timeline durations — healed in memory on webapp ' +
        `load/render; persist with \`vw timeline reflow ${timelineId}\``,
    });
  }

  if (
    Math.abs(overview.timeline.duration - overview.computedDuration) > EPSILON
  ) {
    findings.push({
      level: 'warning',
      code: 'stale-timeline-duration',
      clipIds: [],
      message:
        `stored duration ${secs(overview.timeline.duration)} ≠ computed ` +
        `${secs(overview.computedDuration)} — self-heals on the next clip mutation`,
    });
  }

  findings.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  const errors = findings.filter((f) => f.level === 'error').length;
  const warnings = findings.filter((f) => f.level === 'warning').length;

  return {
    timelineId: overview.timeline.id,
    timelineName: overview.timeline.name,
    computedDuration: overview.computedDuration,
    clipCount: overview.clipCount,
    trackCount: overview.tracks.length,
    findings,
    errors,
    warnings,
    ok: errors === 0,
  };
}
