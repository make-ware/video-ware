'use client';

import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Directory } from '@project/shared';
import { DirectoryMutator } from '@project/shared/mutator';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';

export interface UseDirectoriesReturn {
  /** Flat, name-sorted list — directories have no nesting. */
  directories: Directory[];
  isLoading: boolean;
  error: string | null;

  createDirectory(name: string): Promise<Directory>;
  renameDirectory(id: string, name: string): Promise<void>;
  deleteDirectory(id: string): Promise<void>;
  refresh(): Promise<void>;
}

export function useDirectories(workspaceId: string): UseDirectoriesReturn {
  const mutator = useMemo(() => new DirectoryMutator(pb, { expand: [] }), []);
  const queryClient = useQueryClient();
  const queryKey = qk.directories.list(workspaceId);

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const result = await mutator.getByWorkspace(workspaceId, 1, 500);
      return result.items;
    },
  });

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey }),
    [queryClient, queryKey]
  );

  const createMutation = useMutation({
    mutationFn: (name: string) =>
      mutator.create({ name, WorkspaceRef: workspaceId }),
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
    : null;

  return {
    directories: query.data ?? [],
    isLoading: query.isLoading,
    error,
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
