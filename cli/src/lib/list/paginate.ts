/**
 * Paging primitives: walking every page of one list, and windowing a list
 * that is really N lists merged.
 *
 * The merged case exists because `label search`/`label list`/`entity labels`
 * fan out one query per label type (the 8 `LabelType` collections) and present
 * the union. A merged page 2 is not `page=2` on each sub-query, so instead
 * each source is asked for its own top `page × perPage` rows and the merge is
 * sliced: the global top-K is always contained in the union of the per-source
 * top-K, so any window inside that depth is exact.
 *
 * That over-fetch is why depth is bounded rather than page count — at
 * `perPage = 100` across 8 types, page 1 already reads 800 records. Past
 * the bound the answer is to narrow to one type (which needs no merge and
 * pages without limit), not to fetch deeper.
 */
import type { ListResult } from 'pocketbase';

/** Rows fetched per source before a merged window is refused. */
export const DEFAULT_MAX_MERGE_DEPTH = 500;

/** One page request, as the runner hands it to a fetcher. */
export interface PageRequest {
  page: number;
  perPage: number;
}

/** Fetch every page of a paginated list, in order. */
export async function fetchAll<T>(
  getPage: (page: number) => Promise<ListResult<T>>
): Promise<T[]> {
  const first = await getPage(1);
  const items = [...first.items];
  for (let page = 2; page <= first.totalPages; page++) {
    items.push(...(await getPage(page)).items);
  }
  return items;
}

/**
 * Fetch every page and collapse it into a single envelope, so callers that
 * page and callers that take everything share one shape. `totalItems` stays
 * the server's count; `perPage`/`totalPages` describe the collapsed result.
 */
export async function fetchAllPages<T>(
  getPage: (page: number) => Promise<ListResult<T>>
): Promise<ListResult<T>> {
  const first = await getPage(1);
  const items = [...first.items];
  for (let page = 2; page <= first.totalPages; page++) {
    items.push(...(await getPage(page)).items);
  }
  return {
    page: 1,
    perPage: items.length,
    totalItems: first.totalItems,
    totalPages: 1,
    items,
  };
}

/**
 * Window an already-loaded row set into a `ListResult` page.
 *
 * For structure lists that are always computed whole (a timeline's tracks or
 * clips): the fetcher derives every row, and the requested `--limit`/`--page`
 * window slices that view. `totalItems` stays the full count so the footer and
 * `--json` envelope never understate what exists.
 */
export function windowItems<T>(
  rows: readonly T[],
  window: { page: number; perPage: number; all: boolean }
): ListResult<T> {
  if (window.all) {
    return {
      page: 1,
      perPage: rows.length,
      totalItems: rows.length,
      totalPages: 1,
      items: [...rows],
    };
  }
  const start = (window.page - 1) * window.perPage;
  return {
    page: window.page,
    perPage: window.perPage,
    totalItems: rows.length,
    totalPages: Math.max(1, Math.ceil(rows.length / window.perPage)),
    items: rows.slice(start, start + window.perPage),
  };
}

/** One collection in a fan-out list. */
export interface MergeSource<T> {
  /** Identifies the source in errors, e.g. a label type. */
  key: string;
  /**
   * Fetch one page. MUST be server-sorted by the same key as the merge
   * comparator, otherwise a source's "top K" is not the top K and the slice
   * silently loses rows.
   */
  fetchPage: (request: PageRequest) => Promise<ListResult<T>>;
}

export interface MergedPage<T> {
  /** The requested window, in merge order. */
  items: T[];
  /** Sum of the sources' totals — an upper bound on reachable rows. */
  totalItems: number;
  totalPages: number;
  /** Rows requested per source to satisfy this window. */
  depth: number;
}

/** Deepest page reachable at a given page size before the depth bound bites. */
export function maxMergedPage(
  perPage: number,
  maxDepth = DEFAULT_MAX_MERGE_DEPTH
): number {
  return Math.max(1, Math.floor(maxDepth / Math.max(1, perPage)));
}

function sumTotals<T>(results: readonly ListResult<T>[]): number {
  return results.reduce((sum, result) => sum + result.totalItems, 0);
}

/**
 * One merged window. Each source is read to `page × perPage`, the union is
 * sorted by `compare`, and the requested slice is returned.
 */
export async function fetchMergedPage<T>(args: {
  sources: readonly MergeSource<T>[];
  compare: (a: T, b: T) => number;
  page: number;
  perPage: number;
  maxDepth?: number;
  /** Appended to the depth-exceeded error — how to narrow this command. */
  narrowWith?: string;
}): Promise<MergedPage<T>> {
  const maxDepth = args.maxDepth ?? DEFAULT_MAX_MERGE_DEPTH;
  const depth = args.page * args.perPage;
  const limit = maxMergedPage(args.perPage, maxDepth);

  if (args.sources.length > 1 && args.page > limit) {
    const narrow = args.narrowWith
      ? ` Narrow the query (${args.narrowWith}) to page without a bound`
      : ' Narrow the query to page without a bound';
    throw new Error(
      `Page ${args.page} needs ${depth} rows from each of ` +
        `${args.sources.length} collections, past the ${maxDepth}-row merge ` +
        `depth (max page ${limit} at --limit ${args.perPage}).` +
        `${narrow}, use a smaller --limit, or raise --max-depth.`
    );
  }

  const results = await Promise.all(
    args.sources.map((source) => source.fetchPage({ page: 1, perPage: depth }))
  );

  const merged = results.flatMap((result) => result.items);
  merged.sort(args.compare);

  const totalItems = sumTotals(results);
  return {
    items: merged.slice((args.page - 1) * args.perPage, depth),
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / args.perPage)),
    depth,
  };
}

/** Every row from every source, merged — the `--all` path for a fan-out list. */
export async function fetchMergedAll<T>(args: {
  sources: readonly MergeSource<T>[];
  compare: (a: T, b: T) => number;
  /** Rows per request while walking each source. */
  batchSize?: number;
}): Promise<MergedPage<T>> {
  const perPage = args.batchSize ?? DEFAULT_MAX_MERGE_DEPTH;
  const results = await Promise.all(
    args.sources.map((source) =>
      fetchAllPages((page) => source.fetchPage({ page, perPage }))
    )
  );
  const merged = results.flatMap((result) => result.items);
  merged.sort(args.compare);
  return {
    items: merged,
    totalItems: sumTotals(results),
    totalPages: 1,
    depth: merged.length,
  };
}
