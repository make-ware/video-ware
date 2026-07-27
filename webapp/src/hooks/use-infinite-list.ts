'use client';

/**
 * Generic "filterable list with load-more": a TanStack `useInfiniteQuery` over
 * PocketBase `ListResult` pages, and nothing else. Plain request/response —
 * pages arrive when the user asks for them, and the list is only as fresh as
 * its last fetch plus whatever mutations invalidate.
 *
 * This is the default for list surfaces. Pages that must reflect other
 * clients' writes as they happen layer a realtime subscription on top via
 * `use-live-infinite-list.ts`, which wraps this hook.
 *
 * Paging is envelope-driven: `fetchPage` takes a 1-based page and the
 * returned `page`/`totalPages` decide whether there is a next one. Callers
 * therefore hold no page state — a filter or search change is a new query key,
 * not a page to reset.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { ListResult } from 'pocketbase';
// dedupeById/removeManyFromList and the record/page types are paging-generic
// despite living beside the realtime merges — they predate this split.
import {
  dedupeById,
  removeManyFromList,
  type LiveListData,
  type LiveListRecord,
} from '@/utils/live-list';

export interface UseInfiniteListConfig<T extends LiveListRecord> {
  queryKey: readonly unknown[];
  enabled: boolean;
  /** Fetch one 1-based page; the envelope's page/totalPages drive paging. */
  fetchPage: (page: number) => Promise<ListResult<T>>;
}

export interface UseInfiniteListResult<T extends LiveListRecord> {
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

export function useInfiniteList<T extends LiveListRecord>(
  config: UseInfiniteListConfig<T>
): UseInfiniteListResult<T> {
  const { queryKey, enabled, fetchPage } = config;
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

  // `removeFromCache` must write to the key the list is CURRENTLY showing, not
  // the one captured when the callback was created.
  const queryKeyRef = useRef(queryKey);
  useEffect(() => {
    queryKeyRef.current = queryKey;
  });

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
