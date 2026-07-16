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
import { MediaTypeFilter } from '@/components/media/media-type-filter';
import { Search, Folder, FolderOpen } from 'lucide-react';
import type { Directory } from '@project/shared';
import type { LibrarySortBy } from './types';

interface LibraryToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sortBy: LibrarySortBy;
  onSortChange: (sort: LibrarySortBy) => void;
  /** Media-type filter ('all' | 'video' | 'audio' | 'image'). Hidden when undefined. */
  mediaTypeFilter?: string;
  onMediaTypeFilterChange?: (value: string) => void;
  itemCount?: number;
  itemLabel?: string;
  searchPlaceholder?: string;
  // Directory filter (flat folders; null = all media)
  directories?: Directory[];
  directoryFilter?: string | null;
  onDirectorySelect?: (directoryId: string | null) => void;
}

export function LibraryToolbar({
  searchQuery,
  onSearchChange,
  sortBy,
  onSortChange,
  mediaTypeFilter,
  onMediaTypeFilterChange,
  itemCount,
  itemLabel = 'item',
  searchPlaceholder = 'Search...',
  directories,
  directoryFilter = null,
  onDirectorySelect,
}: LibraryToolbarProps) {
  const showDirectoryNav =
    directories !== undefined && onDirectorySelect !== undefined;
  const showTypeFilter =
    mediaTypeFilter !== undefined && onMediaTypeFilterChange !== undefined;

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
            <MediaTypeFilter
              value={mediaTypeFilter!}
              onChange={onMediaTypeFilterChange!}
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
        <div className="flex items-center gap-1.5 flex-wrap">
          <Button
            variant={directoryFilter == null ? 'default' : 'outline'}
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
              variant={directoryFilter === dir.id ? 'default' : 'outline'}
              size="sm"
              className="h-6 text-[11px] px-2"
              onClick={() => onDirectorySelect!(dir.id)}
            >
              {directoryFilter === dir.id ? (
                <FolderOpen className="mr-1 h-3 w-3" />
              ) : (
                <Folder className="mr-1 h-3 w-3" />
              )}
              <span className="truncate max-w-[100px]">{dir.name}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
