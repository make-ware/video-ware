'use client';

/**
 * Task lifecycle writes (retry / cancel) shared by the task list rows and the
 * task details page. The cache is not patched optimistically: both writes go
 * through PocketBase, so the record's own realtime event folds the new status
 * into the list and detail caches. The invalidation is the belt-and-braces
 * path for a dropped SSE frame.
 */
import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';
import { TaskService } from '@/services/task';

export interface UseTaskActionsResult {
  retryTask: (taskId: string) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  /** Task ids with a write in flight — drives per-row button disabling. */
  pendingIds: ReadonlySet<string>;
}

export function useTaskActions(): UseTaskActionsResult {
  const queryClient = useQueryClient();
  const taskService = useMemo(() => new TaskService(pb), []);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());

  const run = useCallback(
    async (
      taskId: string,
      operation: (id: string) => Promise<unknown>,
      successMessage: string,
      failureMessage: string
    ) => {
      setPendingIds((prev) => new Set(prev).add(taskId));
      try {
        await operation(taskId);
        toast.success(successMessage);
        await queryClient.invalidateQueries({ queryKey: qk.tasks.all });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : failureMessage);
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(taskId);
          return next;
        });
      }
    },
    [queryClient]
  );

  const retryTask = useCallback(
    (taskId: string) =>
      run(
        taskId,
        (id) => taskService.retryTask(id),
        'Task requeued',
        'Failed to retry task'
      ),
    [run, taskService]
  );

  const cancelTask = useCallback(
    (taskId: string) =>
      run(
        taskId,
        (id) => taskService.cancelTask(id),
        'Task canceled',
        'Failed to cancel task'
      ),
    [run, taskService]
  );

  return { retryTask, cancelTask, pendingIds };
}
