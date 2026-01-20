'use client';

import React, {
  createContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { Workspace, WorkspaceMember } from '@project/shared';
import { WorkspaceService } from '@/services/workspace';
import pb from '@/lib/pocketbase-client';
import { useAuth } from '@/hooks/use-auth';

interface WorkspaceContextType {
  currentWorkspace: Workspace | null;
  workspaces: WorkspaceMember[];
  isLoading: boolean;
  error: string | null;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  createWorkspace: (name: string, slug?: string) => Promise<Workspace>;
  refreshWorkspaces: () => Promise<void>;
  clearError: () => void;
  hasWorkspaces: boolean;
  currentMembership: WorkspaceMember | null;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(
  undefined
);

interface WorkspaceProviderProps {
  children: React.ReactNode;
}

export function WorkspaceProvider({ children }: WorkspaceProviderProps) {
  const params = useParams();
  const router = useRouter();
  const workspaceIdParam = params?.workspaceId as string | undefined;
  const { user, isAuthenticated } = useAuth();

  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(
    null
  );
  const [workspaces, setWorkspaces] = useState<WorkspaceMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const workspaceService = useMemo(() => new WorkspaceService(pb), []);

  // Helper to find workspace from ID
  const findWorkspace = useCallback(
    (id: string): Workspace | null => {
      return (
        workspaces.find((m) => m.expand?.WorkspaceRef?.id === id)?.expand
          ?.WorkspaceRef || null
      );
    },
    [workspaces]
  );

  // Load user's workspaces
  const loadWorkspaces = useCallback(async () => {
    if (!user || !isAuthenticated) {
      setWorkspaces([]);
      setCurrentWorkspace(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const userWorkspaces = await workspaceService.getUserWorkspaces(user.id);
      setWorkspaces(userWorkspaces);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load workspaces';
      setError(message);
      console.error('Failed to load workspaces:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user, isAuthenticated, workspaceService]);

  // Sync current workspace from URL parameter
  useEffect(() => {
    if (!workspaceIdParam) {
      setCurrentWorkspace(null);
      return;
    }

    const workspace = findWorkspace(workspaceIdParam);
    if (workspace && workspace.id !== currentWorkspace?.id) {
      setCurrentWorkspace(workspace);
    } else if (!workspace && workspaces.length > 0) {
      // Workspace ID in URL but not found in user's workspaces
      setCurrentWorkspace(null);
    }
  }, [workspaceIdParam, workspaces, findWorkspace, currentWorkspace?.id]);

  // Load workspaces when authenticated
  useEffect(() => {
    if (isAuthenticated && user) {
      loadWorkspaces();
    } else {
      setWorkspaces([]);
      setCurrentWorkspace(null);
      setIsLoading(false);
    }
  }, [isAuthenticated, user, loadWorkspaces]);

  const switchWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!user) throw new Error('Not authenticated');

      setError(null);
      setIsLoading(true);

      try {
        const membership = await workspaceService.getMembership(
          user.id,
          workspaceId
        );

        if (!membership) {
          throw new Error('You do not have access to this workspace');
        }

        router.push(`/ws/${workspaceId}`);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to switch workspace';
        setError(message);
        console.error('Failed to switch workspace:', err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [user, workspaceService, router]
  );

  const createWorkspace = useCallback(
    async (name: string, slug?: string): Promise<Workspace> => {
      if (!user) throw new Error('Not authenticated');

      setError(null);
      setIsLoading(true);

      try {
        const { workspace } =
          await workspaceService.createWorkspaceWithMembership(
            { name, slug },
            user.id
          );

        router.push(`/ws/${workspace.id}`);
        return workspace;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to create workspace';
        setError(message);
        console.error('Failed to create workspace:', err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [user, workspaceService, router]
  );

  const refreshWorkspaces = useCallback(async () => {
    await loadWorkspaces();
  }, [loadWorkspaces]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const hasWorkspaces = workspaces.length > 0;

  const currentMembership = useMemo(() => {
    if (!currentWorkspace) return null;
    return (
      workspaces.find(
        (m) => m.expand?.WorkspaceRef?.id === currentWorkspace.id
      ) || null
    );
  }, [currentWorkspace, workspaces]);

  const value: WorkspaceContextType = {
    currentWorkspace,
    workspaces,
    isLoading,
    error,
    switchWorkspace,
    createWorkspace,
    refreshWorkspaces,
    clearError,
    hasWorkspaces,
    currentMembership,
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export { WorkspaceContext };
