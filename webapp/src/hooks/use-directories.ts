'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Directory } from '@project/shared';
import { DirectoryMutator } from '@project/shared/mutator';
import pb from '@/lib/pocketbase-client';

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

  const [directories, setDirectories] = useState<Directory[]>([]);
  const [currentDirectory, setCurrentDirectory] = useState<Directory | null>(
    null
  );
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const fetchDirectories = useCallback(
    async (dir: Directory | null) => {
      setIsLoading(true);
      setError(null);
      try {
        const result = dir
          ? await mutator.getChildren(dir.id)
          : await mutator.getRootDirectories(workspaceId);
        setDirectories(result.items);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load directories');
      } finally {
        setIsLoading(false);
      }
    },
    [mutator, workspaceId]
  );

  // Fetch on mount and when currentDirectory changes
  useEffect(() => {
    fetchDirectories(currentDirectory);
  }, [currentDirectory, fetchDirectories]);

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
        setError(e instanceof Error ? e.message : 'Failed to navigate');
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

  const createDirectory = useCallback(
    async (name: string): Promise<Directory> => {
      const dir = await mutator.create({
        name,
        WorkspaceRef: workspaceId,
        ParentDirectoryRef: currentDirectory?.id,
      });
      await fetchDirectories(currentDirectory);
      return dir;
    },
    [mutator, workspaceId, currentDirectory, fetchDirectories]
  );

  const renameDirectory = useCallback(
    async (id: string, name: string): Promise<void> => {
      await mutator.rename(id, name);
      await fetchDirectories(currentDirectory);
    },
    [mutator, currentDirectory, fetchDirectories]
  );

  const deleteDirectory = useCallback(
    async (id: string): Promise<void> => {
      await mutator.deleteIfEmpty(id);
      await fetchDirectories(currentDirectory);
    },
    [mutator, currentDirectory, fetchDirectories]
  );

  const refresh = useCallback(async () => {
    await fetchDirectories(currentDirectory);
  }, [currentDirectory, fetchDirectories]);

  return {
    directories,
    currentDirectory,
    breadcrumbs,
    isLoading,
    error,
    navigateTo,
    navigateUp,
    createDirectory,
    renameDirectory,
    deleteDirectory,
    refresh,
  };
}
