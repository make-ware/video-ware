'use client';

import React, {
  createContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { TaskStatus, type Task } from '@project/shared';
import { TaskMutator } from '@project/shared/mutator';
import pb from '@/lib/pocketbase-client';
import type { RecordSubscription } from 'pocketbase';

interface TaskProgress {
  taskId: string;
  progress: number;
  status: string;
}

interface TaskContextType {
  // State
  tasks: Task[];
  isLoading: boolean;
  error: string | null;

  // Operations
  getTaskById: (taskId: string) => Task | undefined;
  getTasksByUpload: (uploadId: string) => Task[];
  getTaskProgress: (taskId: string) => TaskProgress | undefined;
  retryTask: (taskId: string) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;

  // Real-time updates
  isConnected: boolean;

  // Utility methods
  refreshTasks: () => Promise<void>;
  clearError: () => void;
}

const TaskContext = createContext<TaskContextType | undefined>(undefined);

interface TaskProviderProps {
  workspaceId: string;
  children: React.ReactNode;
}

export function TaskProvider({ workspaceId, children }: TaskProviderProps) {
  // State
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Refs for cleanup
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Create mutator - memoized to prevent recreation
  const taskMutator = useMemo(() => new TaskMutator(pb), []);

  // Clear error helper
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Error handler
  const handleError = useCallback((error: unknown, operation: string) => {
    console.error(`Task ${operation} error:`, error);
    const message =
      error instanceof Error ? error.message : `Failed to ${operation} task`;
    setError(message);
  }, []);

  // Load tasks from server
  const loadTasks = useCallback(async () => {
    if (!workspaceId) return;

    setIsLoading(true);
    clearError();

    try {
      // Get all tasks for this workspace
      const result = await taskMutator.getList(
        1,
        100,
        `WorkspaceRef = "${workspaceId}"`,
        '-created'
      );
      setTasks(result.items);
    } catch (error) {
      handleError(error, 'load');
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, taskMutator, clearError, handleError]);

  // Refresh tasks
  const refreshTasks = useCallback(async () => {
    await loadTasks();
  }, [loadTasks]);

  // Get task by ID
  const getTaskById = useCallback(
    (taskId: string): Task | undefined => {
      return tasks.find((t) => t.id === taskId);
    },
    [tasks]
  );

  // Get tasks by upload ID
  const getTasksByUpload = useCallback(
    (uploadId: string): Task[] => {
      return tasks.filter(
        (t) => t.sourceType === 'upload' && t.sourceId === uploadId
      );
    },
    [tasks]
  );

  // Get task progress
  const getTaskProgress = useCallback(
    (taskId: string): TaskProgress | undefined => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return undefined;

      return {
        taskId: task.id,
        progress: task.progress || 0,
        status: Array.isArray(task.status) ? task.status[0] : task.status,
      };
    },
    [tasks]
  );

  // Retry task
  const retryTask = useCallback(
    async (taskId: string) => {
      clearError();
      try {
        await taskMutator.retry(taskId);
        await refreshTasks();
      } catch (error) {
        handleError(error, 'retry');
        throw error;
      }
    },
    [taskMutator, refreshTasks, clearError, handleError]
  );

  // Cancel task
  const cancelTask = useCallback(
    async (taskId: string) => {
      clearError();
      try {
        await taskMutator.update(taskId, {
          status: TaskStatus.CANCELED,
        });
        await refreshTasks();
      } catch (error) {
        handleError(error, 'cancel');
        throw error;
      }
    },
    [taskMutator, refreshTasks, clearError, handleError]
  );

  // Real-time subscription management
  const subscribe = useCallback(async () => {
    if (!workspaceId || unsubscribeRef.current) return;

    try {
      // Subscribe to tasks collection changes for this workspace
      const unsubscribe = await new Promise<() => void>((resolve) => {
        pb.collection('Tasks')
          .subscribe(
            '*',
            (data: RecordSubscription<Task>) => {
              // Only handle updates for this workspace
              if (data.record.WorkspaceRef !== workspaceId) return;

              // Handle real-time updates
              if (data.action === 'create') {
                setTasks((prev) => {
                  // Avoid duplicates
                  const exists = prev.some((t) => t.id === data.record.id);
                  return exists ? prev : [data.record, ...prev];
                });
              } else if (data.action === 'update') {
                setTasks((prev) =>
                  prev.map((t) => (t.id === data.record.id ? data.record : t))
                );
              } else if (data.action === 'delete') {
                setTasks((prev) => prev.filter((t) => t.id !== data.record.id));
              }
            },
            {
              expand: 'workspace,upload,media',
            }
          )
          .then(() => {
            setIsConnected(true);
            return () => {
              pb.collection('Tasks').unsubscribe('*');
              setIsConnected(false);
            };
          });

        // Return the unsubscribe function
        resolve(() => {
          pb.collection('Tasks').unsubscribe('*');
          setIsConnected(false);
        });
      });

      unsubscribeRef.current = unsubscribe;
      setIsConnected(true);
    } catch (error) {
      console.error('Task subscription error:', error);
      setIsConnected(false);
    }
  }, [workspaceId]);

  const unsubscribe = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
      setIsConnected(false);
    }
  }, []);

  // Initialize tasks when workspace changes
  useEffect(() => {
    if (workspaceId) {
      loadTasks();
      subscribe();
    } else {
      // Clear tasks when no workspace
      setTasks([]);
      setIsLoading(false);
      unsubscribe();
    }

    return () => {
      unsubscribe();
    };
  }, [workspaceId, loadTasks, subscribe, unsubscribe]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      unsubscribe();
    };
  }, [unsubscribe]);

  const value: TaskContextType = {
    // State
    tasks,
    isLoading,
    error,

    // Operations
    getTaskById,
    getTasksByUpload,
    getTaskProgress,
    retryTask,
    cancelTask,

    // Real-time updates
    isConnected,

    // Utility methods
    refreshTasks,
    clearError,
  };

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

// Export the context for use in the hook
export { TaskContext };
