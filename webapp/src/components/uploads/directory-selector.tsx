'use client';

import { useState, useEffect, useCallback } from 'react';
import { FolderPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useDirectories } from '@/hooks/use-directories';
import { DirectoryBreadcrumb } from './directory-breadcrumb';
import { DirectoryListItem } from './directory-list-item';
import { DirectoryCreateInline } from './directory-create-inline';

interface DirectorySelectorProps {
  workspaceId: string;
  selectedDirectoryId: string | null;
  onDirectoryChange: (directoryId: string | null) => void;
}

export function DirectorySelector({
  workspaceId,
  selectedDirectoryId: _selectedDirectoryId,
  onDirectoryChange,
}: DirectorySelectorProps) {
  const {
    directories,
    currentDirectory,
    breadcrumbs,
    isLoading: _isLoading,
    navigateTo,
    createDirectory,
    renameDirectory,
    deleteDirectory,
  } = useDirectories(workspaceId);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // Rename dialog state
  const [renameTarget, setRenameTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [renameName, setRenameName] = useState('');

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Sync directoryId to parent whenever navigation changes
  useEffect(() => {
    onDirectoryChange(currentDirectory?.id ?? null);
  }, [currentDirectory, onDirectoryChange]);

  const handleNavigate = useCallback(
    (directoryId: string | null) => {
      navigateTo(directoryId);
    },
    [navigateTo]
  );

  const handleCreate = useCallback(
    async (name: string) => {
      setIsCreating(true);
      try {
        await createDirectory(name);
        setShowCreateForm(false);
      } finally {
        setIsCreating(false);
      }
    },
    [createDirectory]
  );

  const handleRenameOpen = useCallback(
    (id: string, currentName: string) => {
      setRenameTarget({ id, name: currentName });
      setRenameName(currentName);
    },
    []
  );

  const handleRenameSubmit = useCallback(async () => {
    if (!renameTarget || !renameName.trim()) return;
    await renameDirectory(renameTarget.id, renameName.trim());
    setRenameTarget(null);
  }, [renameTarget, renameName, renameDirectory]);

  const handleDeleteOpen = useCallback(
    (id: string, name: string) => {
      setDeleteTarget({ id, name });
      setDeleteError(null);
    },
    []
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteDirectory(deleteTarget.id);
      setDeleteTarget(null);
    } catch (e) {
      setDeleteError(
        e instanceof Error ? e.message : 'Failed to delete directory'
      );
    }
  }, [deleteTarget, deleteDirectory]);

  return (
    <>
      <div className="space-y-2">
        {/* Header row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
            <span className="shrink-0">Upload to:</span>
            <DirectoryBreadcrumb
              breadcrumbs={breadcrumbs}
              onNavigate={handleNavigate}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs shrink-0"
            onClick={() => setShowCreateForm(true)}
          >
            <FolderPlus className="mr-1 h-3 w-3" />
            New Folder
          </Button>
        </div>

        {/* Inline create form */}
        {showCreateForm && (
          <DirectoryCreateInline
            onCreate={handleCreate}
            onCancel={() => setShowCreateForm(false)}
            isCreating={isCreating}
          />
        )}

        {/* Folder list */}
        {directories.length > 0 && (
          <ScrollArea className="max-h-40">
            <div className="space-y-1">
              {directories.map((dir) => (
                <DirectoryListItem
                  key={dir.id}
                  directory={dir}
                  onNavigate={(id) => handleNavigate(id)}
                  onRename={handleRenameOpen}
                  onDelete={handleDeleteOpen}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Rename dialog */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Folder</DialogTitle>
            <DialogDescription>
              Enter a new name for &quot;{renameTarget?.name}&quot;.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            placeholder="Folder name"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
            }}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenameTarget(null)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRenameSubmit}
              disabled={!renameName.trim()}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Folder</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.name}
              &quot;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p className="text-sm text-destructive">{deleteError}</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
