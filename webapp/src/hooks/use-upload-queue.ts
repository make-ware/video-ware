/**
 * useUploadQueue Hook
 *
 * Provides typed access to the upload queue context.
 * This hook wraps the UploadQueueContext and provides convenient access
 * to the queue state and actions.
 */

import { useContext } from 'react';
import { UploadQueueContext } from '@/contexts/upload-queue-context';

/**
 * Hook to access the upload queue state and actions
 *
 * @throws Error if used outside of UploadQueueProvider
 * @returns Upload queue state and actions
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { state, actions } = useUploadQueue();
 *
 *   const handleUpload = (files: File[]) => {
 *     actions.addFiles(files, workspaceId);
 *   };
 *
 *   return (
 *     <div>
 *       <p>Active uploads: {state.activeCount}</p>
 *       <p>Total progress: {state.totalProgress.percentage}%</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useUploadQueue() {
  const context = useContext(UploadQueueContext);

  if (!context) {
    throw new Error(
      'useUploadQueue must be used within an UploadQueueProvider'
    );
  }

  return context;
}
