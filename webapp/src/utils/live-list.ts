/**
 * Pure merge helpers that fold PocketBase realtime (SSE) events into a
 * cached TanStack `InfiniteData<ListResult<T>>` — the generic core of the
 * "filterable live list with load-more" pattern (consumed by
 * `use-live-infinite-list.ts`).
 *
 * Contract — the same invariants as timeline-realtime.ts:
 *
 * - Every function returns the SAME reference when the event is a no-op
 *   (echo of a local write, stale out-of-order event, irrelevant record),
 *   so TanStack Query's structural sharing skips observer notifications.
 * - A cached record is only replaced when the incoming `updated` stamp is
 *   strictly newer (`isRecordNewer`); equal stamps are echoes and drop.
 * - Untouched page-item arrays keep their references; page envelopes are
 *   only rewritten when their totals actually change.
 *
 * Sort-window rule for records not in the loaded window: insert only when
 * the record sorts strictly before the last loaded item (it belongs inside
 * the window) or the window is complete (no more pages server-side). A
 * `create` that lands beyond the window still bumps `totalItems` so
 * "Showing X of Y" stays honest; an `update` for an unknown id beyond the
 * window is ignored entirely — the record already exists server-side and is
 * already counted, so load-more or the next refetch picks it up.
 */
import type { InfiniteData } from '@tanstack/react-query';
import type { ListResult } from 'pocketbase';
import { isRecordNewer, type RealtimeAction } from '@/utils/timeline-realtime';

/** Minimal record shape the merge helpers need. */
export interface LiveListRecord {
  id: string;
  updated?: string;
}

/** The cached shape of a live infinite list (page number as pageParam). */
export type LiveListData<T extends LiveListRecord> = InfiniteData<
  ListResult<T>,
  number
>;

/**
 * Client-side mirror of the server query, used to decide how an SSE record
 * relates to the cached window.
 */
export interface LiveListSpec<T extends LiveListRecord> {
  /**
   * Mirror of the server filter. May approximate operators like `~`
   * (contains); refetches true up any divergence.
   */
  matches: (record: T) => boolean;
  /**
   * Mirror of the server sort. MUST embed a total tiebreak (primary key,
   * then e.g. created desc, then id) so distinct records never compare
   * equal — a 0 result is how "sort key unchanged" is detected on updates.
   */
  compare: (a: T, b: T) => number;
  /**
   * False when `compare` cannot read its key off this record (e.g. the
   * sort key lives on an expand the SSE event did not carry). Such records
   * are never (re)positioned: known ids are replaced in place, unknown ids
   * are not inserted.
   */
  canCompare?: (record: T) => boolean;
}

interface RecordLocation {
  pageIndex: number;
  itemIndex: number;
}

function findRecord<T extends LiveListRecord>(
  pages: ListResult<T>[],
  id: string
): RecordLocation | null {
  for (let p = 0; p < pages.length; p++) {
    const i = pages[p].items.findIndex((item) => item.id === id);
    if (i >= 0) return { pageIndex: p, itemIndex: i };
  }
  return null;
}

/** True when the server holds pages beyond the loaded window. */
function hasMorePages<T extends LiveListRecord>(
  pages: ListResult<T>[]
): boolean {
  const last = pages[pages.length - 1];
  return !!last && last.page < last.totalPages;
}

/**
 * Stamp a new `totalItems` (and derived `totalPages`) onto every page
 * envelope, keeping references for envelopes that already match.
 */
function rewriteTotals<T extends LiveListRecord>(
  pages: ListResult<T>[],
  totalItems: number
): ListResult<T>[] {
  const perPage = pages[0]?.perPage ?? 0;
  const totalPages = perPage > 0 ? Math.ceil(totalItems / perPage) : 0;
  let changed = false;
  const next = pages.map((page) => {
    if (page.totalItems === totalItems && page.totalPages === totalPages) {
      return page;
    }
    changed = true;
    return { ...page, totalItems, totalPages };
  });
  return changed ? next : pages;
}

/** The freshest server total (the last-fetched envelope). */
function currentTotal<T extends LiveListRecord>(
  pages: ListResult<T>[]
): number {
  return pages[pages.length - 1]?.totalItems ?? 0;
}

function withPages<T extends LiveListRecord>(
  data: LiveListData<T>,
  pages: ListResult<T>[],
  totalsDelta: number
): LiveListData<T> {
  const next =
    totalsDelta === 0
      ? pages
      : rewriteTotals(pages, Math.max(0, currentTotal(pages) + totalsDelta));
  return { ...data, pages: next };
}

function removeAt<T extends LiveListRecord>(
  data: LiveListData<T>,
  at: RecordLocation,
  totalsDelta: number
): LiveListData<T> {
  const pages = data.pages.map((page, p) =>
    p === at.pageIndex
      ? { ...page, items: page.items.filter((_, i) => i !== at.itemIndex) }
      : page
  );
  return withPages(data, pages, totalsDelta);
}

function replaceAt<T extends LiveListRecord>(
  data: LiveListData<T>,
  at: RecordLocation,
  record: T
): LiveListData<T> {
  const pages = data.pages.map((page, p) =>
    p === at.pageIndex
      ? {
          ...page,
          items: page.items.map((item, i) =>
            i === at.itemIndex ? record : item
          ),
        }
      : page
  );
  return { ...data, pages };
}

/**
 * Insert into the loaded window per the sort-window rule. Returns the input
 * data unchanged (same reference, before totals) when the record belongs
 * beyond an incomplete window. Page boundaries are never rebalanced — pages
 * are render windows and the UI flattens them.
 */
function insertSorted<T extends LiveListRecord>(
  data: LiveListData<T>,
  record: T,
  spec: LiveListSpec<T>,
  totalsDelta: number
): { data: LiveListData<T>; inserted: boolean } {
  const pages = data.pages;
  let at: RecordLocation | null = null;
  outer: for (let p = 0; p < pages.length; p++) {
    const items = pages[p].items;
    for (let i = 0; i < items.length; i++) {
      if (spec.compare(record, items[i]) < 0) {
        at = { pageIndex: p, itemIndex: i };
        break outer;
      }
    }
  }

  if (!at) {
    // Sorts after every loaded item: append only when the window is the
    // complete result set, otherwise it belongs on an unloaded page.
    if (hasMorePages(pages)) {
      return {
        data: totalsDelta === 0 ? data : withPages(data, pages, totalsDelta),
        inserted: false,
      };
    }
    const lastIndex = pages.length - 1;
    at = { pageIndex: lastIndex, itemIndex: pages[lastIndex].items.length };
  }

  const target = at;
  const nextPages = pages.map((page, p) =>
    p === target.pageIndex
      ? {
          ...page,
          items: [
            ...page.items.slice(0, target.itemIndex),
            record,
            ...page.items.slice(target.itemIndex),
          ],
        }
      : page
  );
  return { data: withPages(data, nextPages, totalsDelta), inserted: true };
}

/**
 * Fold one realtime event into the cached infinite list. Returns the same
 * reference on no-ops.
 */
export function applyListEvent<T extends LiveListRecord>(
  data: LiveListData<T>,
  action: RealtimeAction,
  record: T,
  spec: LiveListSpec<T>
): LiveListData<T> {
  const pages = data.pages;
  if (pages.length === 0) return data;

  const at = findRecord(pages, record.id);

  if (action === 'delete') {
    if (at) return removeAt(data, at, -1);
    // Deleted from an unloaded page: still shrink the server total (PB
    // delete events carry the full record, so `matches` is evaluable).
    if (spec.matches(record)) return withPages(data, pages, -1);
    return data;
  }

  if (action !== 'create' && action !== 'update') return data;

  if (!spec.matches(record)) {
    // Left the filtered result set (or never belonged to it).
    if (!at) return data;
    return removeAt(data, at, -1);
  }

  const comparable = spec.canCompare ? spec.canCompare(record) : true;

  if (at) {
    const existing = pages[at.pageIndex].items[at.itemIndex];
    if (!isRecordNewer(record, existing)) return data;
    // Same id ⇒ the total tiebreak is 0 ⇒ a 0 means the sort key is
    // unchanged; keep position. Also keep position when the record cannot
    // be compared (position may be stale until the next refetch).
    if (!comparable || spec.compare(record, existing) === 0) {
      return replaceAt(data, at, record);
    }
    // Sort key changed: reposition within the window, totals unchanged. A
    // reinsertion beyond an incomplete window drops the record from the
    // window (still counted server-side; load-more re-encounters it and
    // dedupeById guards the overlap).
    return insertSorted(removeAt(data, at, 0), record, spec, 0).data;
  }

  // Unknown id. Without a comparable sort key the record cannot be placed:
  // a create still bumps totals, an update is already counted server-side.
  if (!comparable) {
    return action === 'create' ? withPages(data, pages, 1) : data;
  }
  if (action === 'create') {
    return insertSorted(data, record, spec, 1).data;
  }
  // Update for an id we never loaded (missed create or unloaded page):
  // insert only within the window; beyond it, ignore — no totals bump,
  // since the record is already included in the server's count.
  const { data: next, inserted } = insertSorted(data, record, spec, 0);
  return inserted ? next : data;
}

/**
 * Remove several records at once (optimistic bulk deletion). Totals drop by
 * the number actually removed; same reference when none are present.
 */
export function removeManyFromList<T extends LiveListRecord>(
  data: LiveListData<T>,
  ids: readonly string[]
): LiveListData<T> {
  if (ids.length === 0) return data;
  const idSet = new Set(ids);
  let removed = 0;
  const pages = data.pages.map((page) => {
    const items = page.items.filter((item) => !idSet.has(item.id));
    if (items.length === page.items.length) return page;
    removed += page.items.length - items.length;
    return { ...page, items };
  });
  if (removed === 0) return data;
  return withPages(data, pages, -removed);
}

/**
 * Keep-first dedupe for flattened pages. Realtime repositioning can leave a
 * record in the window that a later load-more page also contains; the first
 * (realtime-merged, newest) occurrence wins. Same reference when there are
 * no duplicates.
 */
export function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  let hasDuplicate = false;
  for (const item of items) {
    if (seen.has(item.id)) {
      hasDuplicate = true;
      break;
    }
    seen.add(item.id);
  }
  if (!hasDuplicate) return items;

  seen.clear();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
