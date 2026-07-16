'use client';

import type { Directory } from '@project/shared';
import {
  Folder,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface DirectoryListItemProps {
  directory: Directory;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, currentName: string) => void;
  onDelete: (id: string, name: string) => void;
}

export function DirectoryListItem({
  directory,
  isSelected,
  onSelect,
  onRename,
  onDelete,
}: DirectoryListItemProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between rounded-md border px-3 py-2 group',
        isSelected && 'border-primary bg-accent'
      )}
    >
      <button
        className="flex items-center gap-2 text-sm font-medium flex-1 text-left cursor-pointer rounded-sm px-1 py-0.5 -mx-1 hover:bg-accent hover:text-accent-foreground active:bg-accent/80 transition-colors"
        onClick={() => onSelect(directory.id)}
      >
        {isSelected ? (
          <FolderOpen className="h-4 w-4 text-primary" />
        ) : (
          <Folder className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
        )}
        {directory.name}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <MoreHorizontal className="h-4 w-4" />
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
