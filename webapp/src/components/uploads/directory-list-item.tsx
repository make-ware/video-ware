'use client';

import type { Directory } from '@project/shared';
import { Folder, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface DirectoryListItemProps {
  directory: Directory;
  onNavigate: (id: string) => void;
  onRename: (id: string, currentName: string) => void;
  onDelete: (id: string, name: string) => void;
}

export function DirectoryListItem({
  directory,
  onNavigate,
  onRename,
  onDelete,
}: DirectoryListItemProps) {
  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2 hover:bg-muted/50">
      <button
        className="flex items-center gap-2 text-sm font-medium flex-1 text-left"
        onClick={() => onNavigate(directory.id)}
      >
        <Folder className="h-4 w-4 text-muted-foreground" />
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
