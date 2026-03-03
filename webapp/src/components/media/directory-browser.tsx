'use client';

import { useEffect, useCallback } from 'react';
import { FolderPlus, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { DirectoryBreadcrumb } from '@/components/uploads/directory-breadcrumb';
import { DirectoryListItem } from '@/components/uploads/directory-list-item';
import { DirectoryCreateInline } from '@/components/uploads/directory-create-inline';
import { DirectoryDialogs } from '@/components/uploads/directory-dialogs';
import { useDirectories } from '@/hooks/use-directories';
import { useDirectoryCrud } from '@/hooks/use-directory-crud';
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

  const crud = useDirectoryCrud({
    createDirectory,
    renameDirectory,
    deleteDirectory,
  });

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

  const hasDirectories = directories.length > 0;
  const isAtRoot = currentDirectory === null;
  const showEmptyRootHint = isAtRoot && !hasDirectories && !crud.showCreateForm;

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
            onClick={crud.openCreateForm}
          >
            <FolderPlus className="mr-1 h-3 w-3" />
            New Folder
          </Button>
        </div>

        {/* Inline create form */}
        {crud.showCreateForm && (
          <DirectoryCreateInline
            onCreate={crud.handleCreate}
            onCancel={crud.closeCreateForm}
            isCreating={crud.isCreating}
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
                  onRename={crud.handleRenameOpen}
                  onDelete={crud.handleDeleteOpen}
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

      <DirectoryDialogs {...crud} />
    </>
  );
}
