'use client';

import { useEffect, useCallback } from 'react';
import { FolderPlus, Folder, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DirectoryBreadcrumb } from '@/components/uploads/directory-breadcrumb';
import { DirectoryCreateInline } from '@/components/uploads/directory-create-inline';
import { DirectoryDialogs } from '@/components/uploads/directory-dialogs';
import { useDirectories } from '@/hooks/use-directories';
import { useDirectoryCrud } from '@/hooks/use-directory-crud';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Directory } from '@project/shared';

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

  // Sync directory tree to match directoryFilter (initial load with ?dir= or back/forward)
  useEffect(() => {
    const currentId = currentDirectory?.id ?? null;
    if (directoryFilter !== currentId) {
      navigateTo(directoryFilter);
    }
    // Only react to directoryFilter changes, not currentDirectory
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directoryFilter]);

  const handleSelect = useCallback(
    (directoryId: string) => {
      navigateTo(directoryId);
      onDirectoryFilterChange(directoryId);
    },
    [navigateTo, onDirectoryFilterChange]
  );

  const handleShowAll = useCallback(() => {
    navigateTo(null);
    onDirectoryFilterChange(null);
  }, [navigateTo, onDirectoryFilterChange]);

  return (
    <>
      <div className="space-y-2">
        {/* Breadcrumb navigation (shown when inside a subfolder) */}
        {breadcrumbs.length > 0 && (
          <DirectoryBreadcrumb
            breadcrumbs={breadcrumbs}
            onNavigate={(id) => {
              navigateTo(id);
              onDirectoryFilterChange(id);
            }}
          />
        )}

        {/* Folder list */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Show All chip */}
          <Button
            variant={directoryFilter === null ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            onClick={handleShowAll}
          >
            <Folder className="mr-1 h-3 w-3" />
            All
          </Button>

          {/* Folder chips */}
          {directories.map((dir) => (
            <FolderChip
              key={dir.id}
              directory={dir}
              isSelected={directoryFilter === dir.id}
              onSelect={handleSelect}
              onRename={crud.handleRenameOpen}
              onDelete={crud.handleDeleteOpen}
            />
          ))}

          {/* New Folder button */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
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
      </div>

      <DirectoryDialogs {...crud} />
    </>
  );
}

function FolderChip({
  directory,
  isSelected,
  onSelect,
  onRename,
  onDelete,
}: {
  directory: Directory;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  return (
    <div className="flex items-center group">
      <Button
        variant={isSelected ? 'default' : 'outline'}
        size="sm"
        className={cn(
          'h-7 text-xs rounded-r-none border-r-0',
          isSelected && 'pr-2'
        )}
        onClick={() => onSelect(directory.id)}
      >
        {isSelected ? (
          <FolderOpen className="mr-1 h-3 w-3" />
        ) : (
          <Folder className="mr-1 h-3 w-3" />
        )}
        {directory.name}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={isSelected ? 'default' : 'outline'}
            size="sm"
            className="h-7 px-1 rounded-l-none"
          >
            <MoreHorizontal className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => onRename(directory.id, directory.name)}
          >
            <Pencil className="mr-2 h-4 w-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onDelete(directory.id, directory.name)}
            className="text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
