/**
 * Pagination footers and the `--json` envelope — all pure, so the exact bytes
 * a user or agent sees are cheap to unit-test.
 *
 * The contract every list ends with:
 *
 *   (1–100 of 3412 — next page: vw media list --page 2)
 *   (narrow instead: --type <mediaType>, --search <text>, -d <dir>)
 *   (add --json for full records; vw media show <id> for one record)
 *
 * The first line always says where you are and whether there is more. The
 * second appears only when it is actionable — there are more pages AND the
 * spec declares filters the caller did not use — because narrowing is almost
 * always the better move than walking pages. The third is the command's own
 * hint, unchanged from the pre-pagination CLI.
 */
import {
  filtersOf,
  flagSummaryOf,
  type AnyListFilter,
  type ListSpec,
} from './spec.js';

/** Everything the footer builders need about a rendered page. */
export interface ListView {
  /** Command path, e.g. `media list`. */
  command: string;
  /** Argv the command was invoked with (`process.argv.slice(2)`). */
  argv: readonly string[];
  page: number;
  perPage: number;
  /** Rows actually printed. */
  shown: number;
  totalItems: number;
  totalPages: number;
  /** Every page was fetched (`--all`, or an unpaged spec). */
  all: boolean;
}

/** True when the server holds pages beyond the one just rendered. */
export function hasMore(view: ListView): boolean {
  if (view.all) return false;
  return view.page < view.totalPages;
}

/** Shell-quote an argv entry that would otherwise re-split. */
function quoteArg(arg: string): string {
  return /[\s"'$`\\*?[\]{}()<>|&;#~]/.test(arg)
    ? `'${arg.replaceAll("'", `'\\''`)}'`
    : arg;
}

/**
 * Rebuild the invoking command line with `--page <n>`, dropping any page flag
 * already present so repeated paging never accumulates them.
 */
export function nextPageCommand(argv: readonly string[], page: number): string {
  const kept: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--page') {
      i++; // also drop its value
      continue;
    }
    if (arg.startsWith('--page=')) continue;
    kept.push(arg);
  }
  return ['vw', ...kept.map(quoteArg), '--page', String(page)].join(' ');
}

/** `1–100 of 3412`, or `7 of 7` when a single page holds everything. */
function rangeLabel(view: ListView): string {
  if (view.all || view.totalPages <= 1) {
    return `${view.shown} of ${view.totalItems}`;
  }
  const start = (view.page - 1) * view.perPage + 1;
  const end = start + view.shown - 1;
  return `${start}–${end} of ${view.totalItems}`;
}

/** The pagination line: where you are, and the way to more (or that there isn't). */
export function paginationLine(view: ListView): string {
  const range = rangeLabel(view);
  if (hasMore(view)) {
    return `(${range} — next page: ${nextPageCommand(view.argv, view.page + 1)})`;
  }
  const ending =
    !view.all && view.totalPages > 1 ? 'end of results' : 'all results shown';
  return `(${range} — ${ending})`;
}

/**
 * The "narrow instead" line: the flags of every filter the caller did not
 * use. Returns null when it would not help — no more pages to avoid, or every
 * declared filter is already applied.
 */
export function narrowHint<T, TRow>(
  spec: ListSpec<T, TRow>,
  view: ListView,
  applied: readonly string[]
): string | null {
  if (!hasMore(view)) return null;
  const unused = Object.entries(filtersOf(spec)).filter(
    ([key]) => !applied.includes(key)
  );
  if (unused.length === 0) return null;
  const flags = unused.map(([, filter]) => valueFlag(filter)).join(', ');
  return `(narrow instead: ${flags})`;
}

/** `-d <dir>` — the compact flag plus its value placeholder. */
function valueFlag(filter: AnyListFilter): string {
  const placeholder = filter.flags.match(/<[^>]+>/)?.[0] ?? '';
  const flags = flagSummaryOf(filter);
  return placeholder ? `${flags} ${placeholder}` : flags;
}

/** The trailing hint line: `--json` plus the command's own suggestion. */
export function hintLine<T, TRow>(spec: ListSpec<T, TRow>): string {
  const parts = ['add --json for full records'];
  if (spec.hint) parts.push(spec.hint);
  return `(${parts.join('; ')})`;
}

/**
 * Every footer line for a rendered page, in order. Empty when nothing was
 * printed — `table()` already says `(none)` and a footer would only add noise.
 */
export function listFooter<T, TRow>(
  spec: ListSpec<T, TRow>,
  view: ListView,
  applied: readonly string[]
): string[] {
  if (view.shown === 0) return [];
  const lines = [paginationLine(view)];
  const narrow = narrowHint(spec, view, applied);
  if (narrow) lines.push(narrow);
  lines.push(hintLine(spec));
  return lines;
}

/** The `--json` document. `items`/`totalItems` keep their pre-pagination meaning. */
export interface ListEnvelope<TRow> {
  items: TRow[];
  totalItems: number;
  page: number;
  perPage: number;
  totalPages: number;
  hasMore: boolean;
  /** null on the last page. */
  nextPage: number | null;
  /** null on the last page; otherwise the exact command to run. */
  nextCommand: string | null;
  /** Filter keys applied to this query. */
  appliedFilters: string[];
  /** Every filter key the command accepts — narrow instead of paging. */
  availableFilters: string[];
}

export function listEnvelope<T, TRow>(
  spec: ListSpec<T, TRow>,
  rows: TRow[],
  view: ListView,
  applied: readonly string[]
): ListEnvelope<TRow> {
  const more = hasMore(view);
  return {
    items: rows,
    totalItems: view.totalItems,
    page: view.page,
    perPage: view.perPage,
    totalPages: view.totalPages,
    hasMore: more,
    nextPage: more ? view.page + 1 : null,
    nextCommand: more ? nextPageCommand(view.argv, view.page + 1) : null,
    appliedFilters: [...applied],
    availableFilters: Object.keys(filtersOf(spec)),
  };
}
