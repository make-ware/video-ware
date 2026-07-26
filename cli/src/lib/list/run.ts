/**
 * The list runners: resolve options → fetch → derive rows → print.
 *
 * A command supplies its spec and a fetcher; everything else — paging, the
 * `--all` walk, `--json`, the table, the footer — happens here, so adding a
 * list is a spec plus one closure and adding a filter is one spec entry.
 *
 * `runList` covers a single collection. `runMergedList` covers a fan-out
 * across several collections (see paginate.ts for why merged windows are
 * depth-bounded rather than page-bounded).
 */
import type { ListResult } from 'pocketbase';
import { info, table } from '../output.js';
import { columnsOf, type ListContext, type ListSpec } from './spec.js';
import { resolveListQuery, type ResolvedListQuery } from './query.js';
import { listEnvelope, listFooter, type ListView } from './footer.js';
import {
  fetchAllPages,
  fetchMergedAll,
  fetchMergedPage,
  windowItems,
  type MergeSource,
  type PageRequest,
} from './paginate.js';

/**
 * An in-memory narrowing the server filter cannot express.
 *
 * The only case today is an edit list's cut gaps: PocketBase can window a
 * clip's outer span, but "does this label overlap any played segment" is a
 * predicate over the whole segment list. Declaring a refinement forces the
 * full walk (see `runList`) — filtering one page would make `--limit` mean "up
 * to N" and leave the footer counting rows the caller never saw.
 */
export interface ListRefinement<T> {
  /** Keep the rows that survive; `dropped` is derived from what it removes. */
  filter: (items: T[]) => T[];
  /** Extra `--json` keys explaining the narrowing (e.g. the edit list). */
  extras?: (dropped: number) => Record<string, unknown>;
  /** Footer note, shown only when rows were actually dropped. */
  note?: (dropped: number) => string | null;
}

/** Shared inputs of both runners. */
interface RunListBase<T, TRow> {
  spec: ListSpec<T, TRow>;
  /** Parsed commander options for the command. */
  opts: Record<string, unknown>;
  ctx: ListContext;
  /** Invoking argv; defaults to `process.argv.slice(2)`. */
  argv?: readonly string[];
  /** Whether an interactive `pick` may run; defaults to stdin's TTY. */
  isTTY?: boolean;
  /** Narrowing that only holds in memory; forces every page to be fetched. */
  refine?: ListRefinement<T>;
  /**
   * Extra top-level keys merged into the `--json` envelope, computed only
   * when `--json` is set — e.g. `directory list`'s workspace-wide media
   * counts, which scripts read alongside `items`.
   */
  jsonExtras?: () => Record<string, unknown> | Promise<Record<string, unknown>>;
}

export interface RunListArgs<T, TRow> extends RunListBase<T, TRow> {
  /** Fetch one page under the resolved filter/sort. */
  fetchPage: (query: ResolvedListQuery) => Promise<ListResult<T>>;
}

export interface RunMergedListArgs<T, TRow> extends RunListBase<T, TRow> {
  /**
   * One entry per collection. Each fetcher must be server-sorted by the same
   * key as `compare`.
   */
  sources: (
    query: ResolvedListQuery
  ) => readonly MergeSource<T>[] | Promise<readonly MergeSource<T>[]>;
  /**
   * Merge order across sources, built from the resolved query — the sort a
   * caller asked for decides both the per-source server sort and this
   * comparator, and the two MUST agree. Constant orders write `() => cmp`.
   */
  compare: (query: ResolvedListQuery) => (a: T, b: T) => number;
  /** How to narrow this command, quoted in the depth-exceeded error. */
  narrowWith?: string;
}

function argvOf(argv?: readonly string[]): readonly string[] {
  return argv ?? process.argv.slice(2);
}

/** Render a fetched page: rows, table or JSON, footer. */
async function present<T, TRow>(args: {
  spec: ListSpec<T, TRow>;
  ctx: ListContext;
  opts: Record<string, unknown>;
  argv: readonly string[];
  items: T[];
  query: ResolvedListQuery;
  totalItems: number;
  totalPages: number;
  refine?: ListRefinement<T>;
  jsonExtras?: () => Record<string, unknown> | Promise<Record<string, unknown>>;
}): Promise<void> {
  const { spec, ctx, query, refine } = args;

  // A refinement always sees the complete set (the runners force the walk),
  // so the surviving count IS the total — the server's count includes the
  // rows it could not express a filter for. The caller's --limit/--page then
  // window what survives, exactly like any other list.
  const kept = refine ? refine.filter(args.items) : args.items;
  const dropped = args.items.length - kept.length;
  const windowed = refine ? windowItems(kept, query) : null;
  const pageItems = windowed ? windowed.items : args.items;
  const totalItems = windowed ? windowed.totalItems : args.totalItems;
  const totalPages = windowed ? windowed.totalPages : args.totalPages;

  const rows = spec.toRows
    ? await spec.toRows(pageItems, ctx)
    : (pageItems as unknown as TRow[]);

  const view: ListView = {
    command: spec.command,
    argv: args.argv,
    page: query.page,
    perPage: query.perPage,
    shown: rows.length,
    totalItems,
    totalPages,
    all: query.all,
  };

  if (args.opts.json) {
    console.log(
      JSON.stringify(
        {
          ...listEnvelope(spec, rows, view, query.applied),
          ...(refine?.extras?.(dropped) ?? {}),
          ...((await args.jsonExtras?.()) ?? {}),
        },
        null,
        2
      )
    );
    return;
  }

  table(rows, columnsOf(spec, rows));
  for (const line of listFooter(spec, view, query.applied)) {
    info(line);
  }
  const note = dropped > 0 ? refine?.note?.(dropped) : null;
  if (note) info(note);
}

/** Run a single-collection list command end to end. */
export async function runList<T, TRow = T>(
  args: RunListArgs<T, TRow>
): Promise<void> {
  const query = await resolveListQuery(args.spec, args.opts, args.ctx, {
    isTTY: args.isTTY,
  });
  // A refinement can only be honest over the complete set, so it always
  // walks every page; the requested window is applied to what survives, in
  // `present`. The query keeps the caller's --limit/--page for that.
  const result =
    query.all || args.refine
      ? await fetchAllPages((page) =>
          args.fetchPage({ ...query, all: true, page })
        )
      : await args.fetchPage(query);

  await present({
    spec: args.spec,
    ctx: args.ctx,
    opts: args.opts,
    argv: argvOf(args.argv),
    items: result.items,
    query,
    totalItems: result.totalItems,
    totalPages: result.totalPages,
    refine: args.refine,
    jsonExtras: args.jsonExtras,
  });
}

/** Run a fan-out list command (several collections presented as one list). */
export async function runMergedList<T, TRow = T>(
  args: RunMergedListArgs<T, TRow>
): Promise<void> {
  const query = await resolveListQuery(args.spec, args.opts, args.ctx, {
    isTTY: args.isTTY,
  });
  const sources = await args.sources(query);
  const compare = args.compare(query);

  // A refinement can only be honest over the complete set, so it always
  // merges every row; the requested window is applied to what survives, in
  // `present`. The query keeps the caller's --limit/--page for that.
  const merged =
    query.all || args.refine
      ? await fetchMergedAll({ sources, compare })
      : await fetchMergedPage({
          sources,
          compare,
          page: query.page,
          perPage: query.perPage,
          maxDepth: args.opts.maxDepth as number | undefined,
          narrowWith: args.narrowWith,
        });

  await present({
    spec: args.spec,
    ctx: args.ctx,
    opts: args.opts,
    argv: argvOf(args.argv),
    items: merged.items,
    query,
    totalItems: merged.totalItems,
    totalPages: merged.totalPages,
    refine: args.refine,
    jsonExtras: args.jsonExtras,
  });
}

/**
 * Build the `PageRequest`-shaped fetcher a merge source needs from a mutator
 * call that takes `(page, perPage, filter, sort, expand)`.
 */
export function mergeSource<T>(
  key: string,
  fetch: (request: PageRequest) => Promise<ListResult<T>>
): MergeSource<T> {
  return { key, fetchPage: fetch };
}
