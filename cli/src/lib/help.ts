/**
 * `--help` epilogues: contracts and overviews too long for a `.description()`.
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

/**
 * The `--help` epilogue every list command shares, attached automatically by
 * `withListOptions`. Mirrors `editResultHelp` for the edit commands: the
 * paging/filtering contract is uniform, so it is documented once here rather
 * than restated per command. The README's "Lists" section carries the same
 * contract — keep both in sync.
 */
export function listResultHelp(
  spec: {
    command: string;
    unpaged?: boolean;
    defaultLimit?: number;
    filters?: Record<string, unknown>;
  },
  config: { merged?: boolean } = {}
): string {
  const filterCount = Object.keys(spec.filters ?? {}).length;
  const parts = [
    `Results:
  Prints one page as a table, then a footer saying where you are and how to
  reach the rest — \`(1–100 of 3412 — next page: vw … --page 2)\`, or
  \`end of results\` on the last page. ${
    spec.unpaged
      ? 'Every row is fetched by default; -n/--page ask for a window instead.'
      : `Page size is ${spec.defaultLimit ?? 100} (-n/--limit); --all walks every page.`
  }`,
  ];

  if (filterCount > 0) {
    parts.push(`Narrowing beats paging:
  While more pages remain, the footer also lists the filters you have not
  used. Applying one is almost always better than walking pages — it is
  fewer requests and a smaller result to read.`);
  }

  parts.push(`JSON:
  --json prints { items, totalItems, page, perPage, totalPages, hasMore,
  nextPage, nextCommand, appliedFilters, availableFilters } and nothing else
  on stdout. Agents should follow \`nextCommand\` while \`hasMore\` is true, or
  narrow using \`availableFilters\`.`);

  if (config.merged) {
    parts.push(`Merged results:
  This command queries several collections and presents the union, so a page
  costs \`page × --limit\` rows from each. Depth is capped (--max-depth,
  default 500); past it, narrow to a single type instead of paging deeper.`);
  }

  return `\n${parts.join('\n\n')}`;
}

/**
 * `vw --help` epilogue: awareness only — that list output explains itself, and
 * that the machine-readable flags exist. Usage lives one level down, in the
 * per-command `listResultHelp` epilogue; keep this to two lines so `vw --help`
 * stays a scannable index.
 */
export const LIST_HINT_HELP = `
Lists:
  Every list/search ends with a footer saying where you are and what to run
  next. Programmatic: --json, --all. Usage: vw <group> list --help.`;

/**
 * `vw directory` overview. The group's own `.description()` stays to one line
 * so `vw --help` reads as a scannable index; the model — flat, optional,
 * filter-only — lives here. The README's "Directories" section carries the
 * same rules; keep both in sync.
 */
export const DIRECTORY_HELP = `
How they work:
  Directories only organize and filter — nothing is stored "inside" one, and
  deleting one never deletes media. They are flat (no nesting) and names are
  unique per workspace, so every <dir> takes a name ("hawaii") or an id.
  Media with no directory sit at the workspace root; media clips follow their
  parent media. "/" (or "none") means no directory: as a filter it selects
  unfiled media, as a move target it unfiles.

  vw dir create hawaii
  vw dir move hawaii <mediaId…>    file media  ("/" unfiles it again)
  vw media list -d hawaii          then edit from just that footage`;

/**
 * `vw entity` overview — what an entity is for, and the path from a detected
 * instance to an edit. Kept out of the group `.description()` for the same
 * reason as `DIRECTORY_HELP`.
 */
export const ENTITY_HELP = `
How they work:
  Detection only produces anonymous instances — "Speaker 1", face track 3, an
  object called "dog". An entity is the real-world person, product, place, or
  thing behind them. Name it once per workspace, link the instances to it, and
  every query below works by that name across all media.

  vw entity create "Jane Doe" -k person
  vw entity link "Jane Doe" --speaker <mediaId>:speaker_0 --face <mediaId>:3
  vw entity words "Jane Doe" --text     everything they say, as a transcript
  vw entity appearances "Jane Doe"      when they are on screen or speaking
  vw label search --entity "Jane Doe"   their labels — vw label clip cuts one

  A link is written on the label's LabelEntity, so it covers every detection
  of that instance within its media; repeat per media to cover a workspace.
  For "this media features X" with no detection involved, use vw media tag.`;

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
