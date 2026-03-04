'use client';

import { useEffect, useCallback } from 'react';
import { FolderPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useDirectories } from '@/hooks/use-directories';
import { useDirectoryCrud } from '@/hooks/use-directory-crud';
import { DirectoryBreadcrumb } from './directory-breadcrumb';
import { DirectoryListItem } from './directory-list-item';
import { DirectoryCreateInline } from './directory-create-inline';
import { DirectoryDialogs } from './directory-dialogs';

interface DirectorySelectorProps {
  workspaceId: string;
  onDirectoryChange: (directoryId: string | null) => void;
}

export function DirectorySelector({
  workspaceId,
  onDirectoryChange,
}: DirectorySelectorProps) {
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
        {directories.length > 0 && (
          <ScrollArea className="max-h-40">
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
      </div>

      <DirectoryDialogs {...crud} />
    </>
  );
}
