import { useState, useEffect, useRef } from 'react';
import pb from '@/lib/pocketbase-client';
import type { Task } from '@project/shared';
import type { RecordSubscription } from 'pocketbase';

// Human-readable label shown in the spinner for each active task type.
const TASK_TYPE_LABELS: Record<string, string> = {
  process_upload: 'Transcoding',
  detect_labels: 'Labeling',
  render_timeline: 'Rendering',
};

function taskLabel(task: Task): string {
  return TASK_TYPE_LABELS[task.type] ?? 'Processing';
}

function mediaIdForTask(task: Task): string | null {
  if (task.sourceType === 'Media') return task.sourceId;
  if (task.sourceType === 'upload') {
    const payload = task.payload as Record<string, unknown>;
    if (typeof payload?.mediaId === 'string') return payload.mediaId;
  }
  return null;
}

/**
 * Whether `task` should be shown over `other` when both target the same
 * media. A running task wins over a merely queued one; among tasks with the
 * same status the oldest wins — tasks are enqueued in pipeline order, so the
 * oldest active task is the stage currently in progress.
 */
function takesPrecedence(task: Task, other: Task): boolean {
  if (task.status !== other.status) return task.status === 'running';
  return task.created < other.created;
}

/**
 * Build a map of media id → spinner label for the media's current task.
 */
export function buildProcessingMap(tasks: Task[]): Map<string, string> {
  const currentTasks = new Map<string, Task>();
  for (const task of tasks) {
    const mediaId = mediaIdForTask(task);
    if (!mediaId) continue;
    const existing = currentTasks.get(mediaId);
    if (!existing || takesPrecedence(task, existing)) {
      currentTasks.set(mediaId, task);
    }
  }
  const labels = new Map<string, string>();
  for (const [mediaId, task] of currentTasks) {
    labels.set(mediaId, taskLabel(task));
  }
  return labels;
}

/**
 * Hook to track which media items have active processing tasks
 * (process_upload or detect_labels with status queued/running).
 * Returns a map of media id → human-readable label for the current task.
 */
export function useProcessingMedia(workspaceId: string | undefined) {
  const [processingMedia, setProcessingMedia] = useState<Map<string, string>>(
    new Map()
  );
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchAndUpdate = async () => {
      if (!workspaceId) {
        setProcessingMedia(new Map());
        return;
      }

      try {
        const result = await pb.collection('Tasks').getList<Task>(1, 200, {
          filter: `WorkspaceRef = "${workspaceId}" && (status = "queued" || status = "running") && (type = "process_upload" || type = "detect_labels")`,
          sort: 'created',
        });
        if (!cancelled) {
          setProcessingMedia(buildProcessingMap(result.items));
        }
      } catch (error) {
        console.error('Failed to fetch processing tasks:', error);
      }
    };

    // Initial fetch
    fetchAndUpdate();

    if (!workspaceId) return;

    // Subscribe to task updates for this workspace
    pb.collection('Tasks')
      .subscribe('*', (data: RecordSubscription<Task>) => {
        if (cancelled) return;
        if (data.record.WorkspaceRef !== workspaceId) return;

        const isRelevant =
          data.record.type === 'process_upload' ||
          data.record.type === 'detect_labels';
        if (!isRelevant) return;

        fetchAndUpdate();
      })
      .then((unsubscribe) => {
        if (!cancelled) {
          unsubscribeRef.current = unsubscribe;
        }
      });

    return () => {
      cancelled = true;
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [workspaceId]);

  return processingMedia;
}
