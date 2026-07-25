'use client';

/**
 * One task, kept live. The record lives in the TanStack Query cache
 * (`qk.tasks.detail`) and a record-scoped PocketBase subscription folds
 * events into it, so progress/status changes stream onto the details page
 * without polling.
 *
 * Realtime invariants (same contract as timeline-context.tsx — see root
 * CLAUDE.md): a cached record is replaced only when the incoming `updated`
 * stamp is strictly newer (echo suppression), the subscription's deps are
 * stable identities (`[taskId, queryClient]`) so data changes can never
 * resubscribe, the per-subscription unsubscribe function is used (never
 * collection-global `unsubscribe('*')`), the detail query is invalidated once
 * after the subscription is live (gap healing), and the handler only touches
 * the query cache — it never writes to the DB.
 */
import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RecordSubscription } from 'pocketbase';
import type { Task } from '@project/shared';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';
import { useAuth } from '@/hooks/use-auth';
import { TaskService } from '@/services/task';
import { isRecordNewer } from '@/utils/timeline-realtime';

export interface UseTaskDetailsResult {
  task: Task | null;
  /** isPending — true while auth gating holds the first fetch. */
  isLoading: boolean;
  /** True once a fetch resolved with no such task (or no read access). */
  notFound: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useTaskDetails(taskId: string): UseTaskDetailsResult {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const taskService = useMemo(() => new TaskService(pb), []);

  const query = useQuery({
    queryKey: qk.tasks.detail(taskId),
    enabled: !!taskId && isAuthenticated,
    queryFn: () => taskService.getTaskById(taskId),
  });

  useEffect(() => {
    if (!taskId || !isAuthenticated) return;

    let disposed = false;
    let unsubscribe: (() => Promise<void> | void) | null = null;

    const handler = (event: RecordSubscription<Task>) => {
      if (event.action === 'delete') {
        queryClient.setQueryData<Task | null>(qk.tasks.detail(taskId), null);
        return;
      }
      queryClient.setQueryData<Task | null>(qk.tasks.detail(taskId), (prev) =>
        prev && !isRecordNewer(event.record, prev) ? prev : event.record
      );
    };

    const subscribed = pb.collection('Tasks').subscribe(taskId, handler);

    subscribed
      .then((unsub) => {
        // StrictMode / fast unmount: the effect may be cleaned up before the
        // subscribe round-trip resolves — release immediately.
        if (disposed) void unsub();
        else unsubscribe = unsub;
      })
      .catch((err) => {
        console.error('Task detail subscription failed:', err);
      });

    // Events landing between the initial fetch's server read and the
    // subscription coming live would otherwise be lost — refetch once now
    // that we're listening.
    void subscribed
      .then(() => {
        if (!disposed) {
          return queryClient.invalidateQueries({
            queryKey: qk.tasks.detail(taskId),
          });
        }
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      if (unsubscribe) void unsubscribe();
    };
  }, [taskId, isAuthenticated, queryClient]);

  return {
    task: query.data ?? null,
    // isPending, not isLoading: a disabled query (auth still hydrating) must
    // read as "loading", or consumers flash their not-found state before the
    // first fetch ever starts.
    isLoading: query.isPending,
    notFound: query.isSuccess && !query.data,
    error: query.error
      ? query.error instanceof Error
        ? query.error.message
        : 'Failed to load task'
      : null,
    refresh: async () => {
      await queryClient.invalidateQueries({
        queryKey: qk.tasks.detail(taskId),
      });
    },
  };
}
