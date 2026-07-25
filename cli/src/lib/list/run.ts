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
  type MergeSource,
  type PageRequest,
} from './paginate.js';

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
}): Promise<void> {
  const { spec, ctx, query } = args;
  const rows = spec.toRows
    ? await spec.toRows(args.items, ctx)
    : (args.items as unknown as TRow[]);

  const view: ListView = {
    command: spec.command,
    argv: args.argv,
    page: query.page,
    perPage: query.perPage,
    shown: rows.length,
    totalItems: args.totalItems,
    totalPages: args.totalPages,
    all: query.all,
  };

  if (args.opts.json) {
    console.log(
      JSON.stringify(listEnvelope(spec, rows, view, query.applied), null, 2)
    );
    return;
  }

  table(rows, columnsOf(spec, rows));
  for (const line of listFooter(spec, view, query.applied)) {
    info(line);
  }
}

/** Run a single-collection list command end to end. */
export async function runList<T, TRow = T>(
  args: RunListArgs<T, TRow>
): Promise<void> {
  const query = await resolveListQuery(args.spec, args.opts, args.ctx, {
    isTTY: args.isTTY,
  });

  const result = query.all
    ? await fetchAllPages((page) => args.fetchPage({ ...query, page }))
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

  const merged = query.all
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
