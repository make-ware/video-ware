import { useContext } from 'react';
import { TaskContext } from '@/contexts/task-context';

/**
 * Hook to access task context
 * Must be used within a TaskProvider
 *
 * @returns TaskContext value
 * @throws Error if used outside TaskProvider
 */
export function useTasks() {
  const context = useContext(TaskContext);

  if (context === undefined) {
    throw new Error('useTasks must be used within a TaskProvider');
  }

  return context;
}
