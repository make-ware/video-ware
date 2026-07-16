'use client';

import { useMemo } from 'react';
import { useTimeline } from '@/hooks/use-timeline';
import {
  collectTimelineDoctorFindings,
  sortDoctorFindings,
  summarizeDoctorFindings,
  type DoctorFinding,
} from '@project/shared';

export interface TimelineDoctorReport {
  /** Sorted most severe first. */
  findings: DoctorFinding[];
  errors: number;
  warnings: number;
  infos: number;
  /** True when no error-level findings exist. */
  ok: boolean;
}

/**
 * Live health report for the loaded timeline — the same checks as
 * `vw timeline doctor`, run over the editor's in-memory clips so issues show
 * up as you edit. The stored-duration check is skipped: the local copy of
 * Timeline.duration goes stale as soon as a clip edit persists (the server
 * heals it via hook), so flagging it here would be noise. Nested-window
 * drift is also absent — the webapp heals that in memory on load.
 */
export function useTimelineDoctor(): TimelineDoctorReport | null {
  const { timeline } = useTimeline();

  return useMemo(() => {
    if (!timeline) return null;
    const findings = sortDoctorFindings(
      collectTimelineDoctorFindings({
        clips: timeline.clips,
        tracks: timeline.tracks ?? [],
      })
    );
    return { findings, ...summarizeDoctorFindings(findings) };
  }, [timeline]);
}
