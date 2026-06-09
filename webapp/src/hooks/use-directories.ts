'use client';

import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Directory } from '@project/shared';
import { DirectoryMutator } from '@project/shared/mutator';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';

interface Breadcrumb {
  id: string;
  name: string;
}

export interface UseDirectoriesReturn {
  directories: Directory[];
  currentDirectory: Directory | null;
  breadcrumbs: Breadcrumb[];
  isLoading: boolean;
  error: string | null;

  navigateTo(directoryId: string | null): void;
  navigateUp(): void;
  createDirectory(name: string): Promise<Directory>;
  renameDirectory(id: string, name: string): Promise<void>;
  deleteDirectory(id: string): Promise<void>;
  refresh(): Promise<void>;
}

export function useDirectories(workspaceId: string): UseDirectoriesReturn {
  const mutator = useMemo(() => new DirectoryMutator(pb), []);
  const queryClient = useQueryClient();

  // Navigation is pure UI state — it drives the query key below.
  const [currentDirectory, setCurrentDirectory] = useState<Directory | null>(
    null
  );
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [navError, setNavError] = useState<string | null>(null);

  const parentId = currentDirectory?.id ?? null;
  const queryKey = qk.directories.children(workspaceId, parentId);

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const result = currentDirectory
        ? await mutator.getChildren(currentDirectory.id)
        : await mutator.getRootDirectories(workspaceId);
      return result.items;
    },
  });

  const buildBreadcrumbs = useCallback(
    async (directory: Directory | null): Promise<Breadcrumb[]> => {
      if (!directory) return [];

      const crumbs: Breadcrumb[] = [];
      let current: Directory | null = directory;

      while (current) {
        crumbs.unshift({ id: current.id, name: current.name });
        if (current.ParentDirectoryRef) {
          current = await mutator.getById(current.ParentDirectoryRef);
        } else {
          current = null;
        }
      }

      return crumbs;
    },
    [mutator]
  );

  const navigateTo = useCallback(
    async (directoryId: string | null) => {
      if (directoryId === null) {
        setCurrentDirectory(null);
        setBreadcrumbs([]);
        return;
      }

      try {
        const dir = await mutator.getById(directoryId);
        if (dir) {
          setCurrentDirectory(dir);
          const crumbs = await buildBreadcrumbs(dir);
          setBreadcrumbs(crumbs);
        }
      } catch (e) {
        setNavError(e instanceof Error ? e.message : 'Failed to navigate');
      }
    },
    [mutator, buildBreadcrumbs]
  );

  const navigateUp = useCallback(() => {
    if (!currentDirectory) return;

    if (currentDirectory.ParentDirectoryRef) {
      navigateTo(currentDirectory.ParentDirectoryRef);
    } else {
      navigateTo(null);
    }
  }, [currentDirectory, navigateTo]);

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey }),
    [queryClient, queryKey]
  );

  const createMutation = useMutation({
    mutationFn: (name: string) =>
      mutator.create({
        name,
        WorkspaceRef: workspaceId,
        ParentDirectoryRef: currentDirectory?.id,
      }),
    onSuccess: invalidate,
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      mutator.rename(id, name),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => mutator.deleteIfEmpty(id),
    onSuccess: invalidate,
  });

  const error = query.error
    ? query.error instanceof Error
      ? query.error.message
      : 'Failed to load directories'
    : navError;

  return {
    directories: query.data ?? [],
    currentDirectory,
    breadcrumbs,
    isLoading: query.isLoading,
    error,
    navigateTo,
    navigateUp,
    createDirectory: (name: string) => createMutation.mutateAsync(name),
    renameDirectory: async (id: string, name: string) => {
      await renameMutation.mutateAsync({ id, name });
    },
    deleteDirectory: async (id: string) => {
      await deleteMutation.mutateAsync(id);
    },
    refresh: async () => {
      await invalidate();
    },
  };
}
