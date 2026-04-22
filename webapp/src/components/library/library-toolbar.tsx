'use client';

import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DirectoryBreadcrumb } from '@/components/uploads/directory-breadcrumb';
import { ClipTypeFilter } from '@/components/clip/clip-type-filter';
import { Search, Folder, FolderOpen } from 'lucide-react';
import type { Directory } from '@project/shared';
import type { LibrarySortBy } from './types';

interface LibraryToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sortBy: LibrarySortBy;
  onSortChange: (sort: LibrarySortBy) => void;
  /** Hidden when undefined — used only for the Clips tab. */
  typeFilter?: string;
  onTypeFilterChange?: (value: string) => void;
  itemCount?: number;
  itemLabel?: string;
  searchPlaceholder?: string;
  // Directory
  directories?: Directory[];
  currentDirectory?: Directory | null;
  breadcrumbs?: { id: string; name: string }[];
  onDirectorySelect?: (directoryId: string | null) => void;
}

export function LibraryToolbar({
  searchQuery,
  onSearchChange,
  sortBy,
  onSortChange,
  typeFilter,
  onTypeFilterChange,
  itemCount,
  itemLabel = 'item',
  searchPlaceholder = 'Search...',
  directories,
  currentDirectory,
  breadcrumbs,
  onDirectorySelect,
}: LibraryToolbarProps) {
  const showDirectoryNav =
    directories !== undefined && onDirectorySelect !== undefined;
  const showTypeFilter =
    typeFilter !== undefined && onTypeFilterChange !== undefined;

  return (
    <div className="flex flex-col gap-3 px-4 py-3 border-b flex-shrink-0">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Select
          value={sortBy}
          onValueChange={(val) => onSortChange(val as LibrarySortBy)}
        >
          <SelectTrigger className="w-[120px] h-9">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Recent</SelectItem>
            <SelectItem value="duration">Duration</SelectItem>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="media_time">Creation Time</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {(showTypeFilter || itemCount !== undefined) && (
        <div className="flex items-center justify-between">
          {showTypeFilter ? (
            <ClipTypeFilter
              value={typeFilter!}
              onChange={onTypeFilterChange!}
            />
          ) : (
            <div />
          )}
          {itemCount !== undefined && itemCount > 0 && (
            <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground/60">
              {itemCount} {itemLabel}
              {itemCount !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}

      {showDirectoryNav && (
        <div className="space-y-1.5">
          {breadcrumbs && breadcrumbs.length > 0 && (
            <DirectoryBreadcrumb
              breadcrumbs={breadcrumbs}
              onNavigate={(id) => onDirectorySelect!(id)}
            />
          )}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Button
              variant={currentDirectory == null ? 'default' : 'outline'}
              size="sm"
              className="h-6 text-[11px] px-2"
              onClick={() => onDirectorySelect!(null)}
            >
              <Folder className="mr-1 h-3 w-3" />
              All
            </Button>
            {directories!.map((dir) => (
              <Button
                key={dir.id}
                variant={
                  currentDirectory?.id === dir.id ? 'default' : 'outline'
                }
                size="sm"
                className="h-6 text-[11px] px-2"
                onClick={() => onDirectorySelect!(dir.id)}
              >
                {currentDirectory?.id === dir.id ? (
                  <FolderOpen className="mr-1 h-3 w-3" />
                ) : (
                  <Folder className="mr-1 h-3 w-3" />
                )}
                <span className="truncate max-w-[100px]">{dir.name}</span>
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
