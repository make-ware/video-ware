'use client';

import { useCallback, useState } from 'react';
import { FolderPlus, Folder } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useDirectories } from '@/hooks/use-directories';
import { useDirectoryCrud } from '@/hooks/use-directory-crud';
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
  const { directories, createDirectory, renameDirectory, deleteDirectory } =
    useDirectories(workspaceId);

  // null = workspace root (no directory)
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelect = useCallback(
    (directoryId: string | null) => {
      setSelectedId(directoryId);
      onDirectoryChange(directoryId);
    },
    [onDirectoryChange]
  );

  const crud = useDirectoryCrud({
    createDirectory,
    renameDirectory,
    // Deleting the selected directory falls back to the workspace root.
    deleteDirectory: async (id: string) => {
      await deleteDirectory(id);
      if (id === selectedId) handleSelect(null);
    },
  });

  const selected = directories.find((d) => d.id === selectedId);

  return (
    <>
      <div className="space-y-2">
        {/* Header row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
            <span className="shrink-0">Upload to:</span>
            <span className="truncate font-medium text-foreground">
              {selected ? selected.name : 'Workspace root'}
            </span>
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
              <button
                className={cn(
                  'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium text-left cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors',
                  selectedId === null && 'border-primary bg-accent'
                )}
                onClick={() => handleSelect(null)}
              >
                <Folder className="h-4 w-4 text-muted-foreground" />
                Workspace root
              </button>
              {directories.map((dir) => (
                <DirectoryListItem
                  key={dir.id}
                  directory={dir}
                  isSelected={selectedId === dir.id}
                  onSelect={(id) => handleSelect(id)}
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
