'use client';

import { useState, useCallback } from 'react';

interface DirectoryTarget {
  id: string;
  name: string;
}

interface DirectoryCrudDeps {
  createDirectory: (name: string) => Promise<unknown>;
  renameDirectory: (id: string, name: string) => Promise<void>;
  deleteDirectory: (id: string) => Promise<void>;
}

export interface UseDirectoryCrudReturn {
  // Create
  showCreateForm: boolean;
  isCreating: boolean;
  openCreateForm: () => void;
  closeCreateForm: () => void;
  handleCreate: (name: string) => Promise<void>;

  // Rename
  renameTarget: DirectoryTarget | null;
  renameName: string;
  setRenameName: (name: string) => void;
  handleRenameOpen: (id: string, currentName: string) => void;
  handleRenameClose: () => void;
  handleRenameSubmit: () => Promise<void>;

  // Delete
  deleteTarget: DirectoryTarget | null;
  deleteError: string | null;
  handleDeleteOpen: (id: string, name: string) => void;
  handleDeleteClose: () => void;
  handleDeleteConfirm: () => Promise<void>;
}

export function useDirectoryCrud(
  deps: DirectoryCrudDeps
): UseDirectoryCrudReturn {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const [renameTarget, setRenameTarget] = useState<DirectoryTarget | null>(
    null
  );
  const [renameName, setRenameName] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<DirectoryTarget | null>(
    null
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleCreate = useCallback(
    async (name: string) => {
      setIsCreating(true);
      try {
        await deps.createDirectory(name);
        setShowCreateForm(false);
      } finally {
        setIsCreating(false);
      }
    },
    [deps]
  );

  const handleRenameOpen = useCallback((id: string, currentName: string) => {
    setRenameTarget({ id, name: currentName });
    setRenameName(currentName);
  }, []);

  const handleRenameClose = useCallback(() => {
    setRenameTarget(null);
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    if (!renameTarget || !renameName.trim()) return;
    await deps.renameDirectory(renameTarget.id, renameName.trim());
    setRenameTarget(null);
  }, [renameTarget, renameName, deps]);

  const handleDeleteOpen = useCallback((id: string, name: string) => {
    setDeleteTarget({ id, name });
    setDeleteError(null);
  }, []);

  const handleDeleteClose = useCallback(() => {
    setDeleteTarget(null);
    setDeleteError(null);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deps.deleteDirectory(deleteTarget.id);
      setDeleteTarget(null);
    } catch (e) {
      setDeleteError(
        e instanceof Error ? e.message : 'Failed to delete directory'
      );
    }
  }, [deleteTarget, deps]);

  return {
    showCreateForm,
    isCreating,
    openCreateForm: useCallback(() => setShowCreateForm(true), []),
    closeCreateForm: useCallback(() => setShowCreateForm(false), []),
    handleCreate,
    renameTarget,
    renameName,
    setRenameName,
    handleRenameOpen,
    handleRenameClose,
    handleRenameSubmit,
    deleteTarget,
    deleteError,
    handleDeleteOpen,
    handleDeleteClose,
    handleDeleteConfirm,
  };
}
