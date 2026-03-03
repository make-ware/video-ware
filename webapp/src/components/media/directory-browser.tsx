'use client';

import { useState, useEffect, useCallback } from 'react';
import { FolderPlus, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
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
import { DirectoryBreadcrumb } from '@/components/uploads/directory-breadcrumb';
import { DirectoryListItem } from '@/components/uploads/directory-list-item';
import { DirectoryCreateInline } from '@/components/uploads/directory-create-inline';
import { useDirectories } from '@/hooks/use-directories';
import {
  Empty,
  EmptyHeader,
  EmptyMedia as EmptyMediaIcon,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';

interface DirectoryBrowserProps {
  workspaceId: string;
  directoryFilter: string | null;
  onDirectoryFilterChange: (filter: string | null) => void;
}

export function DirectoryBrowser({
  workspaceId,
  directoryFilter,
  onDirectoryFilterChange,
}: DirectoryBrowserProps) {
  const {
    directories,
    currentDirectory,
    breadcrumbs,
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

  // Sync directory filter when navigation changes
  useEffect(() => {
    onDirectoryFilterChange(currentDirectory?.id ?? null);
  }, [currentDirectory, onDirectoryFilterChange]);

  // Sync back when directoryFilter is cleared externally
  useEffect(() => {
    if (directoryFilter === null && currentDirectory !== null) {
      navigateTo(null);
    }
  }, [directoryFilter, currentDirectory, navigateTo]);

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

  const handleRenameOpen = useCallback((id: string, currentName: string) => {
    setRenameTarget({ id, name: currentName });
    setRenameName(currentName);
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    if (!renameTarget || !renameName.trim()) return;
    await renameDirectory(renameTarget.id, renameName.trim());
    setRenameTarget(null);
  }, [renameTarget, renameName, renameDirectory]);

  const handleDeleteOpen = useCallback((id: string, name: string) => {
    setDeleteTarget({ id, name });
    setDeleteError(null);
  }, []);

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

  const hasDirectories = directories.length > 0;
  const isAtRoot = currentDirectory === null;
  const showEmptyRootHint = isAtRoot && !hasDirectories && !showCreateForm;

  return (
    <>
      <div className="space-y-3">
        {/* Header with breadcrumb + actions */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
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
        {hasDirectories && (
          <ScrollArea className="max-h-48">
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

        {/* Empty state for root with no folders */}
        {showEmptyRootHint && (
          <Empty className="py-4">
            <EmptyHeader>
              <EmptyMediaIcon variant="icon">
                <FolderOpen className="h-6 w-6" />
              </EmptyMediaIcon>
              <EmptyTitle className="text-base">No folders yet</EmptyTitle>
              <EmptyDescription>
                Create folders to organize your media files
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        <Separator />
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
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleRenameSubmit} disabled={!renameName.trim()}>
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
              Are you sure you want to delete &quot;
              {deleteTarget?.name}&quot;? This action cannot be undone.
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
