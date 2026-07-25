'use client';

/**
 * Generic "filterable live list with load-more" hook: a TanStack
 * `useInfiniteQuery` over PocketBase `ListResult` pages, kept fresh by a
 * PocketBase realtime subscription whose events fold into the cache via the
 * pure merges in `utils/live-list.ts`.
 *
 * Realtime invariants (same contract as timeline-context.tsx — see root
 * CLAUDE.md): the subscription is identified by `subscription.key` alone,
 * so filter/sort/search changes never resubscribe (volatile inputs reach
 * the handler through refs); per-subscription unsubscribe functions are
 * used (never collection-global `unsubscribe('*')`); after the
 * subscription is live the `gapHealKey` prefix is invalidated once, so
 * events landing between the initial fetch's server read and subscription
 * setup are never lost; handlers only touch the query cache and never
 * write to the DB.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type PocketBase from 'pocketbase';
import type { ListResult, RecordSubscription } from 'pocketbase';
import pb from '@/lib/pocketbase-client';
import {
  applyListEvent,
  dedupeById,
  removeManyFromList,
  type LiveListData,
  type LiveListRecord,
  type LiveListSpec,
} from '@/utils/live-list';

export interface LiveListSubscription {
  /** PocketBase collection name. */
  collection: string;
  /** Subscription topic; defaults to '*' (all records). */
  topic?: string;
  /**
   * Server-side options. Keep the filter coarse and stable (e.g. the
   * workspace) — fine-grained, volatile filtering belongs in `spec.matches`.
   */
  options?: { filter?: string; expand?: string };
  /**
   * Stable subscription identity: the effect (re)subscribes ONLY when this
   * changes. Client-side filters/search/sort must NOT be part of it.
   */
  key: string;
  /** Query-key prefix invalidated once after the subscription is live. */
  gapHealKey: readonly unknown[];
}

export interface UseLiveInfiniteListConfig<T extends LiveListRecord> {
  queryKey: readonly unknown[];
  enabled: boolean;
  /** Fetch one 1-based page; the envelope's page/totalPages drive paging. */
  fetchPage: (page: number) => Promise<ListResult<T>>;
  /** Client mirror of the server filter + sort (see LiveListSpec). */
  spec: LiveListSpec<T>;
  /** Pure, synchronous mapping applied to SSE records before merging. */
  mapEvent?: (record: T) => T;
  /** Realtime wiring; null disables the subscription. */
  subscription: LiveListSubscription | null;
}

export interface UseLiveInfiniteListResult<T extends LiveListRecord> {
  /** All loaded pages, flattened and deduped, in server sort order. */
  items: T[];
  /** Freshest server total (0 until the first page arrives). */
  totalItems: number;
  /** isPending — true while auth/enabled gating holds the first fetch. */
  isLoading: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  /** Fetch the next page; no-op while showing placeholder data. */
  loadMore: () => void;
  error: string | null;
  reload: () => Promise<unknown>;
  /** Optimistically drop records from the current key's cache. */
  removeFromCache: (ids: readonly string[]) => void;
}

export function useLiveInfiniteList<T extends LiveListRecord>(
  config: UseLiveInfiniteListConfig<T>
): UseLiveInfiniteListResult<T> {
  const { queryKey, enabled, fetchPage, spec, mapEvent, subscription } = config;
  const queryClient = useQueryClient();

  const query = useInfiniteQuery({
    queryKey,
    enabled,
    initialPageParam: 1,
    getNextPageParam: (lastPage: ListResult<T>) =>
      lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    // Keep the previous list visible while a filter/sort/search change
    // fetches its first page, avoiding a flicker to empty.
    placeholderData: (prev) => prev,
  });

  // Volatile inputs flow to the (stable) subscription handler through refs
  // so events always merge into the CURRENT filter's cache entry with the
  // CURRENT matches/compare — without ever resubscribing.
  const queryKeyRef = useRef(queryKey);
  const specRef = useRef(spec);
  const mapEventRef = useRef(mapEvent);
  const subscriptionRef = useRef(subscription);
  useEffect(() => {
    queryKeyRef.current = queryKey;
    specRef.current = spec;
    mapEventRef.current = mapEvent;
    subscriptionRef.current = subscription;
  });

  const subscriptionKey = subscription?.key ?? null;

  useEffect(() => {
    if (!enabled || !subscriptionKey) return;
    const target = subscriptionRef.current;
    if (!target) return;

    let disposed = false;
    let unsubscribe: (() => Promise<void> | void) | null = null;

    const handler = (event: RecordSubscription<T>) => {
      const record = mapEventRef.current
        ? mapEventRef.current(event.record)
        : event.record;
      queryClient.setQueryData<LiveListData<T>>(queryKeyRef.current, (prev) =>
        prev
          ? applyListEvent(prev, event.action, record, specRef.current)
          : prev
      );
    };

    // Upcast to the base client: the hook is collection-agnostic, so the
    // name is a runtime string rather than a TypedPocketBase literal.
    const subscribed = (pb as PocketBase)
      .collection(target.collection)
      .subscribe<T>(target.topic ?? '*', handler, target.options);

    subscribed
      .then((unsub) => {
        // StrictMode / fast unmount: the effect may be cleaned up before
        // the subscribe round-trip resolves — release immediately.
        if (disposed) void unsub();
        else unsubscribe = unsub;
      })
      .catch((err) => {
        console.error(
          `Live list subscription failed (${target.collection}):`,
          err
        );
      });

    // Events landing between the initial fetch's server read and the
    // subscription coming live would otherwise be lost — refetch once now
    // that we're listening.
    void subscribed
      .then(() => {
        if (!disposed) {
          return queryClient.invalidateQueries({
            queryKey: target.gapHealKey,
          });
        }
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      if (unsubscribe) void unsubscribe();
    };
  }, [subscriptionKey, enabled, queryClient]);

  const items = useMemo(() => {
    const flat = query.data?.pages.flatMap((page) => page.items) ?? [];
    return dedupeById(flat);
  }, [query.data]);

  const totalItems =
    query.data?.pages[query.data.pages.length - 1]?.totalItems ?? 0;

  const { fetchNextPage, isPlaceholderData, isFetchingNextPage, hasNextPage } =
    query;
  const loadMore = useCallback(() => {
    // While showing another key's placeholder data, "page 2" would belong
    // to that other result set — wait for the real first page.
    if (isPlaceholderData || isFetchingNextPage || !hasNextPage) return;
    void fetchNextPage();
  }, [fetchNextPage, isPlaceholderData, isFetchingNextPage, hasNextPage]);

  const removeFromCache = useCallback(
    (ids: readonly string[]) => {
      queryClient.setQueryData<LiveListData<T>>(queryKeyRef.current, (prev) =>
        prev ? removeManyFromList(prev, ids) : prev
      );
    },
    [queryClient]
  );

  return {
    items,
    totalItems,
    // isPending (not isLoading) so an auth-gated disabled query still reads
    // as loading instead of flashing an empty state.
    isLoading: query.isPending,
    isFetching: query.isFetching,
    isFetchingNextPage,
    hasNextPage: hasNextPage ?? false,
    loadMore,
    error: query.error
      ? query.error instanceof Error
        ? query.error.message
        : 'Failed to load list'
      : null,
    reload: () => query.refetch(),
    removeFromCache,
  };
}
