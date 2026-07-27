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
import { ClipTypeFilter } from '@/components/clip/clip-type-filter';
import { Search, Folder, FolderOpen } from 'lucide-react';
import type { Directory } from '@project/shared';
import type { LibrarySortChoice } from './types';

interface LibraryToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sortBy: string;
  onSortChange: (sort: string) => void;
  /** The tab's sort choices; the caller narrows the value it receives back. */
  sortOptions: readonly LibrarySortChoice[];
  /** Media-type filter ('all' | 'video' | 'audio' | 'image'). Hidden when undefined. */
  mediaTypeFilter?: string;
  onMediaTypeFilterChange?: (value: string) => void;
  /** Clip-type filter ('all' | ClipType). Hidden when undefined. */
  clipTypeFilter?: string;
  onClipTypeFilterChange?: (value: string) => void;
  /**
   * Server-side total for the current filters — not the loaded count. Pass
   * undefined while the first page is in flight so the badge doesn't read
   * "0" next to the loading skeletons.
   */
  totalItems?: number;
  itemLabel?: string;
  /** Defaults to `itemLabel + 's'`; set it for labels like "media". */
  itemLabelPlural?: string;
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
  sortOptions,
  mediaTypeFilter,
  onMediaTypeFilterChange,
  clipTypeFilter,
  onClipTypeFilterChange,
  totalItems,
  itemLabel = 'item',
  itemLabelPlural,
  searchPlaceholder = 'Search...',
  directories,
  directoryFilter = null,
  onDirectorySelect,
}: LibraryToolbarProps) {
  const showDirectoryNav =
    directories !== undefined && onDirectorySelect !== undefined;
  const showTypeFilter =
    mediaTypeFilter !== undefined && onMediaTypeFilterChange !== undefined;
  const showClipTypeFilter =
    clipTypeFilter !== undefined && onClipTypeFilterChange !== undefined;

  return (
    <div className="flex flex-col gap-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-3 border-b flex-shrink-0">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Select value={sortBy} onValueChange={onSortChange}>
          {/* A 120px select plus the search box overflowed a phone's row. */}
          <SelectTrigger className="w-24 shrink-0 sm:w-[120px] h-9">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            {sortOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {(showTypeFilter || showClipTypeFilter || totalItems !== undefined) && (
        <div className="flex items-center justify-between gap-2">
          {showTypeFilter || showClipTypeFilter ? (
            // The two fixed-width selects can't share a phone's row with the
            // count, so they split a grid and the count keeps its own column.
            <div className="grid flex-1 grid-cols-2 gap-2 min-w-0 sm:flex sm:flex-none sm:items-center">
              {showClipTypeFilter && (
                <ClipTypeFilter
                  value={clipTypeFilter!}
                  onChange={onClipTypeFilterChange!}
                  className="w-full h-8 text-xs sm:h-7 sm:w-[130px]"
                />
              )}
              {showTypeFilter && (
                <MediaTypeFilter
                  value={mediaTypeFilter!}
                  onChange={onMediaTypeFilterChange!}
                  className="w-full h-8 text-xs sm:h-7 sm:w-[150px]"
                />
              )}
            </div>
          ) : (
            <div />
          )}
          {totalItems !== undefined && (
            <div className="shrink-0 text-[10px] uppercase font-bold tracking-wider text-muted-foreground/60">
              {totalItems}{' '}
              {totalItems === 1
                ? itemLabel
                : (itemLabelPlural ?? `${itemLabel}s`)}
            </div>
          )}
        </div>
      )}

      {showDirectoryNav && (
        // A scroll strip on phones (wrapping folders ate the whole sheet) and
        // 32px-tall chips, since 24px is under any touch-target guidance.
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-x-visible sm:pb-0">
          <Button
            variant={directoryFilter == null ? 'default' : 'outline'}
            size="sm"
            className="h-8 shrink-0 text-[11px] px-2 sm:h-6"
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
              className="h-8 shrink-0 text-[11px] px-2 sm:h-6"
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
