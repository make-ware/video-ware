import { useContext } from 'react';
import { WorkspaceContext } from '@/contexts/workspace-context';

/**
 * Hook to access workspace context
 * Must be used within a WorkspaceProvider
 *
 * @returns WorkspaceContext value
 * @throws Error if used outside WorkspaceProvider
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { currentWorkspace, switchWorkspace } = useWorkspace();
 *
 *   return (
 *     <div>
 *       <h1>{currentWorkspace?.name}</h1>
 *       <button onClick={() => switchWorkspace('workspace-id')}>
 *         Switch Workspace
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useWorkspace() {
  const context = useContext(WorkspaceContext);

  if (context === undefined) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }

  return context;
}
