import {
  collectTimelineDoctorFindings,
  sortDoctorFindings,
  summarizeDoctorFindings,
  type DoctorFinding,
  type TypedPocketBase,
} from '@project/shared';
import { getTimelineOverview } from './timeline-inspect.js';
import { planTimelineReflow } from './timeline-reflow.js';

/**
 * `timeline doctor`: verifiable health checks over a timeline's placed
 * clips, so an agent (or human) can confirm a batch of edits left the
 * timeline consistent instead of eyeballing `timeline show` output.
 *
 * Detection lives in @project/shared (collectTimelineDoctorFindings) and is
 * shared with the webapp editor's doctor modal; this module adds the data
 * loading, the nested-window drift check (which needs extra fetches), and
 * the `vw` remediation hints.
 */

export type { DoctorCode, DoctorFinding, DoctorLevel } from '@project/shared';

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

/** Append the `vw` remediation hint matching a shared finding's code. */
function withCliHint(finding: DoctorFinding): DoctorFinding {
  const width = (finding.end ?? 0) - (finding.start ?? 0);
  switch (finding.code) {
    case 'track-overlap':
      return {
        ...finding,
        message: `${finding.message}; reposition with \`vw timeline clips move <id> --at <s>\``,
      };
    case 'micro-gap':
      return {
        ...finding,
        message:
          `${finding.message} (close it with \`vw timeline clips ripple ` +
          `${finding.clipIds[1]} --by=-${width.toFixed(3)}\`)`,
      };
    case 'track-gap':
      return {
        ...finding,
        message:
          `${finding.message} (if unintended, close it with \`vw timeline ` +
          `clips ripple ${finding.clipIds[1]} --by=-${width.toFixed(2)}\`)`,
      };
    case 'stale-clip-duration':
      return {
        ...finding,
        message: `${finding.message} — refresh with \`vw timeline clips update\` re-trimming the clip`,
      };
    case 'dangling-media':
      return {
        ...finding,
        message: `${finding.message}; remove the clip or restore the media`,
      };
    case 'dangling-track':
      return {
        ...finding,
        message:
          `${finding.message}; re-home it with \`vw timeline clips move ` +
          `${finding.clipIds[0]} --track <layer>\``,
      };
    case 'duplicate-track-layer':
      return {
        ...finding,
        message:
          `${finding.message}; re-layer or delete one with \`vw timeline ` +
          'track update/delete <trackId>`',
      };
    case 'dangling-caption':
      return {
        ...finding,
        message: `${finding.message}; remove the clip or restore the caption`,
      };
    default:
      return finding;
  }
}

/**
 * Check a timeline for same-track overlaps (invalid per the data model),
 * dangling references, stale stored durations, micro-gaps, gaps between
 * clips, and nested-window drift.
 */
export async function doctorTimeline(
  pb: TypedPocketBase,
  timelineId: string
): Promise<DoctorReport> {
  const overview = await getTimelineOverview(pb, timelineId);
  const findings = collectTimelineDoctorFindings({
    clips: overview.clips,
    tracks: overview.trackRecords,
    storedDuration: overview.timeline.duration,
  }).map(withCliHint);

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

  const sorted = sortDoctorFindings(findings);
  const { errors, warnings, ok } = summarizeDoctorFindings(sorted);

  return {
    timelineId: overview.timeline.id,
    timelineName: overview.timeline.name,
    computedDuration: overview.computedDuration,
    clipCount: overview.clipCount,
    trackCount: overview.tracks.length,
    findings: sorted,
    errors,
    warnings,
    ok,
  };
}
