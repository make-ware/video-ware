'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { MediaClipMutator } from '@project/shared/mutator';
import { useWorkspace } from '@/hooks/use-workspace';
import { useTimeline } from '@/hooks/use-timeline';
import { useDirectories } from '@/hooks/use-directories';
import pb from '@/lib/pocketbase-client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DirectoryBreadcrumb } from '@/components/uploads/directory-breadcrumb';
import { Search, Film, AlertCircle, Folder, FolderOpen } from 'lucide-react';
import { ClipBrowserItem } from './clip-browser-item';
import {
  ClipTypeFilter,
  clipTypeFilterPredicate,
} from '@/components/clip/clip-type-filter';
import { ExpandedMediaClip } from '@/types/expanded-types';
import { CLIP_GRID_CLASS } from './constants';

interface ClipBrowserProps {
  height?: number;
  directoryFilter?: string | null;
  onDirectoryFilterChange?: (filter: string | null) => void;
}

export function ClipBrowser({
  height: _height = 300,
  directoryFilter = null,
  onDirectoryFilterChange,
}: ClipBrowserProps) {
  const { currentWorkspace } = useWorkspace();
  const { addClip } = useTimeline();
  const [clips, setClips] = useState<ExpandedMediaClip[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [sortBy, setBySort] = useState<
    'recent' | 'duration' | 'name' | 'media_time'
  >('recent');
  // Create mutator instance
  const mediaClipMutator = useMemo(() => new MediaClipMutator(pb), []);

  // Directory filter
  const { directories, currentDirectory, breadcrumbs, navigateTo } =
    useDirectories(currentWorkspace?.id ?? '');

  // Sync directory tree to match directoryFilter prop (initial load with ?dir=)
  useEffect(() => {
    const currentId = currentDirectory?.id ?? null;
    if (directoryFilter !== currentId) {
      navigateTo(directoryFilter);
    }
    // Only react to directoryFilter changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directoryFilter]);

  // Navigate and notify parent
  const handleDirectorySelect = useCallback(
    (dirId: string | null) => {
      navigateTo(dirId);
      onDirectoryFilterChange?.(dirId);
    },
    [navigateTo, onDirectoryFilterChange]
  );

  // The directoryId to pass to the API filter
  const directoryFilterId = currentDirectory?.id ?? undefined;

  // No longer using fixed grid dimensions

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Load clips from workspace
  const loadClips = useCallback(async () => {
    if (!currentWorkspace) return;

    setIsLoading(true);
    setError(null);

    try {
      // For grouped filters (media/clips), fetch all and filter client-side
      const isGroupedFilter = typeFilter === 'media' || typeFilter === 'clips';
      const result = await mediaClipMutator.getByWorkspace(
        currentWorkspace.id,
        1,
        100,
        {
          type:
            typeFilter !== 'all' && !isGroupedFilter ? typeFilter : undefined,
          searchQuery: debouncedSearchQuery || undefined,
          directoryId: directoryFilterId,
        }
      );

      let items = result.items as ExpandedMediaClip[];

      if (isGroupedFilter) {
        const predicate = clipTypeFilterPredicate(typeFilter);
        items = items.filter((clip) => predicate(clip.type));
      }

      // Client-side sorting
      if (sortBy === 'name') {
        items.sort((a, b) => {
          const nameA = a.expand?.MediaRef?.expand?.UploadRef?.name || '';
          const nameB = b.expand?.MediaRef?.expand?.UploadRef?.name || '';
          return nameA.localeCompare(nameB);
        });
      } else if (sortBy === 'duration') {
        items.sort((a, b) => b.end - b.start - (a.end - a.start));
      } else if (sortBy === 'media_time') {
        items.sort((a, b) => {
          // Get mediaDate (default to 0 if missing)
          const dateA = a.expand?.MediaRef?.mediaDate
            ? new Date(a.expand.MediaRef.mediaDate).getTime()
            : 0;
          const dateB = b.expand?.MediaRef?.mediaDate
            ? new Date(b.expand.MediaRef.mediaDate).getTime()
            : 0;

          // Add start offset (in milliseconds)
          const timeA = dateA + a.start * 1000;
          const timeB = dateB + b.start * 1000;

          return timeA - timeB;
        });
      } else {
        // Default to recent (creation date)
        items.sort(
          (a, b) =>
            new Date(b.created).getTime() - new Date(a.created).getTime()
        );
      }

      setClips(items);
    } catch (err) {
      console.error('Failed to load clips:', err);
      setError(err instanceof Error ? err.message : 'Failed to load clips');
    } finally {
      setIsLoading(false);
    }
  }, [
    currentWorkspace,
    mediaClipMutator,
    typeFilter,
    debouncedSearchQuery,
    sortBy,
    directoryFilterId,
  ]);

  // Load clips when workspace or filters change
  useEffect(() => {
    loadClips();
  }, [loadClips]);

  const handleAddClip = useCallback(
    async (clip: ExpandedMediaClip) => {
      try {
        await addClip(clip.MediaRef, clip.start, clip.end, clip.id);
      } catch (err) {
        console.error('Failed to add clip:', err);
      }
    },
    [addClip]
  );

  // Removed horizontal scroll with mouse wheel effect

  if (!currentWorkspace) {
    return (
      <div className="p-4 h-full flex items-center justify-center">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Select a workspace to browse clips.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header with Search and Filter */}
      <div className="flex flex-col gap-3 px-4 py-3 border-b flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search clips..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          <Select
            value={sortBy}
            onValueChange={(val) =>
              setBySort(val as 'recent' | 'duration' | 'name' | 'media_time')
            }
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
        <div className="flex items-center justify-between">
          <ClipTypeFilter value={typeFilter} onChange={setTypeFilter} />
          {clips.length > 0 && (
            <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground/60">
              {clips.length} clip{clips.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>

        {/* Directory Filter */}
        <div className="space-y-1.5">
          {breadcrumbs.length > 0 && (
            <DirectoryBreadcrumb
              breadcrumbs={breadcrumbs}
              onNavigate={(id) => handleDirectorySelect(id)}
            />
          )}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Button
              variant={currentDirectory === null ? 'default' : 'outline'}
              size="sm"
              className="h-6 text-[11px] px-2"
              onClick={() => handleDirectorySelect(null)}
            >
              <Folder className="mr-1 h-3 w-3" />
              All
            </Button>
            {directories.map((dir) => (
              <Button
                key={dir.id}
                variant={
                  currentDirectory?.id === dir.id ? 'default' : 'outline'
                }
                size="sm"
                className="h-6 text-[11px] px-2"
                onClick={() => handleDirectorySelect(dir.id)}
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
      </div>

      {/* Content Area with Fluid Grid */}
      <div
        className="flex-1 overflow-y-auto px-4 py-4"
        style={{ scrollbarWidth: 'thin' }}
      >
        {isLoading && clips.length === 0 ? (
          <div className={CLIP_GRID_CLASS}>
            {Array.from({ length: 6 }).map((_, i) => (
              <ClipCardSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center">
            <Alert variant="destructive" className="max-w-md">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        ) : clips.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              {currentDirectory ? (
                <FolderOpen className="h-12 w-12 mx-auto mb-3 opacity-50" />
              ) : (
                <Film className="h-12 w-12 mx-auto mb-3 opacity-50" />
              )}
              <p className="text-sm font-medium">
                {currentDirectory
                  ? 'No clips in this folder'
                  : 'No clips found'}
              </p>
              {searchQuery && (
                <p className="text-xs mt-1">Try adjusting your search</p>
              )}
              {currentDirectory && !searchQuery && (
                <Button
                  variant="link"
                  size="sm"
                  className="text-xs mt-1"
                  onClick={() => handleDirectorySelect(null)}
                >
                  Show all folders
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className={`${CLIP_GRID_CLASS} pb-8`}>
            {clips.map((clip: ExpandedMediaClip) => (
              <ClipBrowserItem
                key={clip.id}
                clip={clip}
                onAddToTimeline={handleAddClip}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ClipCardSkeleton() {
  return (
    <Card className="overflow-hidden w-full h-40">
      <CardContent className="p-2.5 h-full flex flex-col">
        <Skeleton className="w-full h-24 rounded mb-2 flex-shrink-0" />
        <div className="flex-1 flex flex-col gap-1 min-h-0 text-xs">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-2.5 w-1/2" />
        </div>
      </CardContent>
    </Card>
  );
}
