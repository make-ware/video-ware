import { useState, useEffect, useRef } from 'react';
import pb from '@/lib/pocketbase-client';
import type { Task } from '@project/shared';
import type { RecordSubscription } from 'pocketbase';

function extractMediaIds(tasks: Task[]): Set<string> {
  const mediaIds = new Set<string>();
  for (const task of tasks) {
    if (task.sourceType === 'Media') {
      mediaIds.add(task.sourceId);
    } else if (task.sourceType === 'upload') {
      const payload = task.payload as Record<string, unknown>;
      if (typeof payload?.mediaId === 'string') {
        mediaIds.add(payload.mediaId);
      }
    }
  }
  return mediaIds;
}

/**
 * Hook to track which media items have active processing tasks
 * (process_upload or detect_labels with status queued/running)
 */
export function useProcessingMedia(workspaceId: string | undefined) {
  const [processingMediaIds, setProcessingMediaIds] = useState<Set<string>>(
    new Set()
  );
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchAndUpdate = async () => {
      if (!workspaceId) {
        setProcessingMediaIds(new Set());
        return;
      }

      try {
        const result = await pb.collection('Tasks').getList<Task>(1, 200, {
          filter: `WorkspaceRef = "${workspaceId}" && (status = "queued" || status = "running") && (type = "process_upload" || type = "detect_labels")`,
        });
        if (!cancelled) {
          setProcessingMediaIds(extractMediaIds(result.items));
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

  return processingMediaIds;
}
