'use client';

/**
 * The tasks application of the generic live infinite list (see
 * use-live-infinite-list.ts): server-side workspace/status/type/search
 * filters and sort, plus a workspace-scoped Tasks realtime subscription.
 *
 * Unlike media, task records need no enrichment — the list renders only own
 * fields — so SSE records merge exactly as they arrive (no mapEvent, no
 * canCompare).
 */
import { useMemo } from 'react';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';
import { useAuth } from '@/hooks/use-auth';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import {
  useLiveInfiniteList,
  type LiveListSubscription,
  type UseLiveInfiniteListResult,
} from '@/hooks/use-live-infinite-list';
import type { LiveListSpec } from '@/utils/live-list';
import { TaskService } from '@/services/task';
import type { Task } from '@project/shared';
import { taskStatusFilterPredicate } from '@/components/task/task-status-filter';
import { taskTypeFilterPredicate } from '@/components/task/task-type-filter';
import {
  getTaskSortOption,
  type TaskSortValue,
} from '@/components/task/task-sort';

export const TASKS_PAGE_SIZE = 25;

export interface UseTaskListArgs {
  workspaceId: string | undefined;
  /** 'all' | 'active' | one TaskStatus. */
  statusFilter: string;
  /** 'all' | one TaskType. */
  typeFilter: string;
  /** Raw input; debounced 300ms internally. */
  searchQuery: string;
  sort: TaskSortValue;
}

/**
 * Client-side mirror of the server filter `listTasks` builds. Search is a
 * case-insensitive substring test over id, type, sourceId, and errorLog — an
 * approximation of PB's `~` operator, close enough for realtime merge
 * decisions (refetches true up any divergence).
 */
export function buildTaskMatches(args: {
  workspaceId: string;
  status: string;
  type: string;
  search: string;
}): (record: Task) => boolean {
  const statusPredicate = taskStatusFilterPredicate(args.status);
  const typePredicate = taskTypeFilterPredicate(args.type);
  const search = args.search.trim().toLowerCase();
  return (record) => {
    if (record.WorkspaceRef !== args.workspaceId) return false;
    if (!statusPredicate(record.status)) return false;
    if (!typePredicate(record.type)) return false;
    if (search) {
      const haystacks = [
        record.id,
        record.type,
        record.sourceId,
        record.errorLog,
      ];
      if (!haystacks.some((text) => text?.toLowerCase().includes(search))) {
        return false;
      }
    }
    return true;
  };
}

export function useTaskList(
  args: UseTaskListArgs
): UseLiveInfiniteListResult<Task> {
  const { workspaceId, statusFilter, typeFilter, searchQuery, sort } = args;
  const { isAuthenticated } = useAuth();
  const taskService = useMemo(() => new TaskService(pb), []);

  const debouncedSearch = useDebouncedValue(searchQuery);

  const sortOption = getTaskSortOption(sort);

  const spec = useMemo<LiveListSpec<Task>>(
    () => ({
      matches: buildTaskMatches({
        workspaceId: workspaceId ?? '',
        status: statusFilter,
        type: typeFilter,
        search: debouncedSearch,
      }),
      compare: sortOption.compare,
    }),
    [workspaceId, statusFilter, typeFilter, debouncedSearch, sortOption]
  );

  // Server-side filter stays coarse and stable (the workspace) so
  // status / type / search / sort changes never resubscribe; fine-grained
  // relevance is spec.matches' job.
  const subscription = useMemo<LiveListSubscription | null>(
    () =>
      workspaceId
        ? {
            collection: 'Tasks',
            topic: '*',
            key: `Tasks:${workspaceId}`,
            options: {
              filter: pb.filter('WorkspaceRef = {:ws}', { ws: workspaceId }),
            },
            gapHealKey: qk.tasks.lists,
          }
        : null,
    [workspaceId]
  );

  return useLiveInfiniteList<Task>({
    queryKey: qk.tasks.list({
      workspaceId: workspaceId ?? '',
      status: statusFilter,
      type: typeFilter,
      sort: sortOption.value,
      search: debouncedSearch,
    }),
    enabled: !!workspaceId && isAuthenticated,
    fetchPage: (page) =>
      taskService.listTasks(
        {
          workspaceId: workspaceId ?? '',
          status: statusFilter,
          type: typeFilter,
          search: debouncedSearch,
        },
        page,
        TASKS_PAGE_SIZE,
        sortOption.pbSort
      ),
    spec,
    subscription,
  });
}
