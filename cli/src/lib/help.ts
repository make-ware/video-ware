/**
 * Shared `--help` epilogues for edit commands.
 *
 * The structured-outcome contracts — the warnings taxonomy (lib/warnings.ts),
 * write elision on no-ops, and the concurrent-edit guard (lib/conflict.ts) —
 * apply uniformly across the timeline/clip edit commands, so their help text
 * lives here once and each command appends the sections it supports via
 * `.addHelpText('after', editResultHelp({ … }))`. The README's "Timeline
 * semantics" and "JSON output for agents" sections carry the same contracts;
 * keep all three in sync when the taxonomy changes.
 */

/** The structured `warnings` array every edit result carries. */
const WARNINGS_HELP = `Warnings:
  The result carries a \`warnings\` array — { level, code, message, clipIds,
  data? } — one uniform channel for "succeeded, but not exactly as asked".
  It is part of the --json document; warning-level entries also print as ⚠
  lines on stderr (notices surface as the command's detail lines instead).

  Levels: \`warning\` = the outcome deviates from what was requested or is
  irreversible; \`notice\` = the documented effect of a flag that was
  explicitly passed, or a no-op.

  Codes:
    nudged              placed later than requested, past a collision
    clamped             requested shift/slip reduced by bounds or neighbors
    shifted-others      other clips displaced under an explicit --ripple
    trimmed             --overwrite trimmed overlapping clips (reversible)
    removed             --overwrite deleted covered clips (irreversible)
    noop                nothing changed — no write was performed
    stale-read          concurrent edit detected; re-planned on fresh state
    post-write-overlap  final state has an overlap involving this op's clips

  Warnings never change the exit code on their own; --strict exits 1 when
  any warning-level entry exists.`;

/** Write elision: ops that can no-op also return a top-level boolean. */
const NOOP_HELP = `No-op edits:
  An edit that matches the stored state (same position, same field values,
  an unchanged edit list) skips the write entirely and reports a top-level
  \`noop: true\`, so a record's \`updated\` timestamp keeps meaning "content
  changed".`;

/** The stale-read re-plan/abort contract of conflict-guarded commands. */
const CONFLICT_HELP = `Concurrent edits:
  The writes are guarded: if a record this command writes changed between
  the command's read and its write, what happens depends on what changed
  remotely. Fields this command does not touch — the operation re-plans
  once against the fresh state and reports a \`stale-read\` warning. The
  same fields it patches (or \`meta\`, which is replaced whole) — it aborts
  before writing; pass --force to re-apply this command over the fresh
  state anyway.`;

export interface EditHelpSections {
  /** The op can skip its write and report a top-level `noop: true`. */
  noop?: boolean;
  /** The op is conflict-guarded (accepts --force). */
  conflict?: boolean;
}

/**
 * The `--help` epilogue for an edit command: the warnings contract always,
 * plus the no-op and concurrent-edit sections where the command supports
 * them.
 */
export function editResultHelp(sections: EditHelpSections = {}): string {
  const parts = [WARNINGS_HELP];
  if (sections.noop) parts.push(NOOP_HELP);
  if (sections.conflict) parts.push(CONFLICT_HELP);
  return `\n${parts.join('\n\n')}`;
}

/** `timeline doctor` findings taxonomy and exit-code contract. */
export const DOCTOR_HELP = `
Checks (reported most severe first):
  error    track-overlap (same-track overlaps are invalid),
           dangling-media / dangling-caption (rendering will fail),
           dangling-track (clip points at a deleted track),
           duplicate-track-layer (two tracks share a layer number)
  warning  stale-timeline-duration / stale-clip-duration (self-heal on the
           next clip mutation), dangling-media-clip (provenance only),
           nested-window-drift (persist the fix with \`timeline reflow\`),
           micro-gap (clips nearly touching — usually unintended)
  info     track-gap (an ordinary gap between clips)

  Exits 1 when any error-level finding exists, so agents can use doctor as
  an "am I done" gate. --json returns { timelineId, timelineName,
  computedDuration, clipCount, trackCount, findings: [{ level, code,
  message, clipIds, layer?, start?, end? }], errors, warnings, ok }.`;
