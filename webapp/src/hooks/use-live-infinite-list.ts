'use client';

/**
 * `useInfiniteList` plus a PocketBase realtime subscription: the same
 * load-more paging, kept fresh by SSE events folded into the cache via the
 * pure merges in `utils/live-list.ts`.
 *
 * Paging lives entirely in `use-infinite-list.ts` — this hook adds only the
 * subscription. A list that does not need other clients' writes to appear
 * without a refresh should use that hook directly rather than passing
 * `subscription: null` here, since `spec` is meaningless without a
 * subscription to apply it to.
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
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type PocketBase from 'pocketbase';
import type { ListResult, RecordSubscription } from 'pocketbase';
import pb from '@/lib/pocketbase-client';
import {
  useInfiniteList,
  type UseInfiniteListResult,
} from '@/hooks/use-infinite-list';
import {
  applyListEvent,
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

export type UseLiveInfiniteListResult<T extends LiveListRecord> =
  UseInfiniteListResult<T>;

export function useLiveInfiniteList<T extends LiveListRecord>(
  config: UseLiveInfiniteListConfig<T>
): UseLiveInfiniteListResult<T> {
  const { queryKey, enabled, fetchPage, spec, mapEvent, subscription } = config;
  const queryClient = useQueryClient();

  const list = useInfiniteList<T>({ queryKey, enabled, fetchPage });

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

  return list;
}
