import type { DoctorFinding } from '@project/shared';
import { warn } from './output.js';

/**
 * Structured soft outcomes for timeline edit operations.
 *
 * Every edit op returns a `warnings` array alongside its result so `--json`
 * consumers get one uniform channel for "the command succeeded, but not
 * exactly as asked". Levels follow the deviation rule:
 *
 * - `warning` — the outcome deviates from what was requested, or is
 *   irreversible: a clip nudged past a collision, a ripple clamped short,
 *   clips deleted by --overwrite, a concurrent edit detected.
 * - `notice` — the documented behavior of a flag that was explicitly passed
 *   (--ripple shifting neighbors, --overwrite trimming), or a no-op.
 *
 * Human output prints only warning-level entries (as `⚠` stderr lines);
 * notices already surface as the commands' detail lines (per-shift/per-trim
 * reports, no-op summaries), so printing them twice would be noise.
 */

export type OpWarningLevel = 'warning' | 'notice';

export type OpWarningCode =
  | 'nudged' // operated clip landed later than requested (collision)
  | 'clamped' // requested shift/slip reduced by bounds or neighbors
  | 'shifted-others' // other clips displaced under an explicit --ripple
  | 'trimmed' // --overwrite trimmed other clips (reversible windows)
  | 'removed' // --overwrite deleted clips (irreversible)
  | 'noop' // nothing changed — no write was performed
  | 'stale-read' // record changed concurrently; op re-planned on fresh state
  | 'post-write-overlap'; // final state has an overlap involving this op's clips

export interface OpWarning {
  level: OpWarningLevel;
  code: OpWarningCode;
  message: string;
  /** Clips the entry is about (displaced / trimmed / removed / unchanged). */
  clipIds: string[];
  /** Machine-readable detail, e.g. { requestedAt: 10, placedAt: 14.2 }. */
  data?: Record<string, number>;
}

const secs = (v: number) => `${v.toFixed(2)}s`;
const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}s`;

/** The operated clip was pushed past a collision to a later time. */
export function nudgedWarning(
  requestedAt: number,
  placedAt: number,
  clipIds: string[]
): OpWarning {
  return {
    level: 'warning',
    code: 'nudged',
    message:
      `requested ${secs(requestedAt)} — nudged to ${secs(placedAt)} past ` +
      'existing clips (use --ripple to make room at the exact time)',
    clipIds,
    data: { requestedAt, placedAt },
  };
}

/** A requested shift/slip was reduced by bounds or neighboring clips. */
export function clampedWarning(
  requestedBy: number,
  appliedBy: number,
  reason: string,
  clipIds: string[]
): OpWarning {
  return {
    level: 'warning',
    code: 'clamped',
    message: `requested ${signed(requestedBy)} — clamped to ${signed(appliedBy)} ${reason}`,
    clipIds,
    data: { requestedBy, appliedBy },
  };
}

/** Other clips were displaced under an explicit --ripple. */
export function shiftedOthersNotice(
  message: string,
  clipIds: string[]
): OpWarning {
  return { level: 'notice', code: 'shifted-others', message, clipIds };
}

/** --overwrite trimmed other clips (their windows can be widened back). */
export function trimmedNotice(trimmedClipIds: string[]): OpWarning {
  return {
    level: 'notice',
    code: 'trimmed',
    message:
      `--overwrite trimmed ${trimmedClipIds.length} overlapping clip(s): ` +
      trimmedClipIds.join(', '),
    clipIds: trimmedClipIds,
  };
}

/** --overwrite deleted fully-covered clips — the one irreversible outcome. */
export function removedWarning(removedClipIds: string[]): OpWarning {
  return {
    level: 'warning',
    code: 'removed',
    message:
      `--overwrite removed ${removedClipIds.length} fully-covered clip(s) ` +
      `(irreversible): ${removedClipIds.join(', ')}`,
    clipIds: removedClipIds,
  };
}

/** The operation changed nothing; no write was performed. */
export function noopNotice(message: string, clipIds: string[]): OpWarning {
  return { level: 'notice', code: 'noop', message, clipIds };
}

/** A concurrent edit was detected and the op re-planned on fresh state. */
export function staleReadWarning(recordId: string): OpWarning {
  return {
    level: 'warning',
    code: 'stale-read',
    message:
      `record ${recordId} changed while this command ran (another editor?) ` +
      '— the operation re-planned against the fresh state',
    clipIds: [recordId],
  };
}

/**
 * The op's own writes succeeded, but re-checking the final track state found
 * an error-level overlap involving the clips this op touched. The check
 * reports the state, not the cause — it can't tell a concurrent edit from a
 * ripple that missed a clip, so the message stays neutral about blame.
 */
export function postWriteOverlapWarning(
  finding: DoctorFinding,
  timelineId: string
): OpWarning {
  return {
    level: 'warning',
    code: 'post-write-overlap',
    message:
      `${finding.message} — detected after this command's writes; ` +
      `inspect with \`vw timeline doctor ${timelineId}\` and reposition ` +
      `with \`vw timeline clips move\``,
    clipIds: finding.clipIds,
  };
}

/**
 * Print warning-level entries as `⚠` stderr lines. Notice-level entries are
 * deliberately NOT printed: the commands already render their substance as
 * detail lines (per-trim/per-shift reports, no-op summaries) — the
 * structured entries exist so `--json` consumers get one uniform channel.
 */
export function printOpWarnings(warnings: OpWarning[]): void {
  for (const w of warnings) {
    if (w.level === 'warning') warn(w.message);
  }
}

/**
 * `--strict`: a command that completed with warning-level outcomes exits 1,
 * so agent pipelines don't build on a result that deviates from what they
 * asked for. Notices never trip it.
 */
export function enforceStrict(warnings: OpWarning[], strict?: boolean): void {
  if (!strict) return;
  const count = warnings.filter((w) => w.level === 'warning').length;
  if (count > 0) {
    warn(`--strict: ${count} warning(s) — exiting 1`);
    process.exitCode = 1;
  }
}

/** The noop entry's message, when the op elided its write entirely. */
export function noopMessage(warnings: OpWarning[]): string | undefined {
  return warnings.find((w) => w.code === 'noop')?.message;
}
