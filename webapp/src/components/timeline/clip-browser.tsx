'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { MediaClipMutator } from '@project/shared/mutator';
import { ClipType } from '@project/shared';
import { useWorkspace } from '@/hooks/use-workspace';
import { useTimeline } from '@/hooks/use-timeline';
import pb from '@/lib/pocketbase-client';
import { Input } from '@/components/ui/input';
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
import { Search, Film, AlertCircle } from 'lucide-react';
import { ClipBrowserItem, type MediaClipWithExpand } from './clip-browser-item';
import { CLIP_GRID_CLASS } from './constants';

interface ClipBrowserProps {
  height?: number;
}

const CLIP_TYPE_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: ClipType.USER, label: 'User' },
  { value: ClipType.RANGE, label: 'Range' },
  { value: ClipType.SHOT, label: 'Shot' },
  { value: ClipType.OBJECT, label: 'Object' },
  { value: ClipType.PERSON, label: 'Person' },
  { value: ClipType.SPEECH, label: 'Speech' },
  { value: ClipType.RECOMMENDATION, label: 'Recommendation' },
];

export function ClipBrowser({ height: _height = 300 }: ClipBrowserProps) {
  const { currentWorkspace } = useWorkspace();
  const { addClip } = useTimeline();
  const [clips, setClips] = useState<MediaClipWithExpand[]>([]);
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
      const result = await mediaClipMutator.getByWorkspace(
        currentWorkspace.id,
        1,
        100,
        {
          type: typeFilter !== 'all' ? typeFilter : undefined,
          searchQuery: debouncedSearchQuery || undefined,
        }
      );

      const items = result.items as MediaClipWithExpand[];

      // Client-side sorting
      if (sortBy === 'name') {
        items.sort((a, b) => {
          const nameA = a.expand?.MediaRef?.expand?.UploadRef?.filename || '';
          const nameB = b.expand?.MediaRef?.expand?.UploadRef?.filename || '';
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
  ]);

  // Load clips when workspace or filters change
  useEffect(() => {
    loadClips();
  }, [loadClips]);

  const handleAddClip = useCallback(
    async (clip: MediaClipWithExpand) => {
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
          <Select value={sortBy} onValueChange={(val: any) => setBySort(val)}>
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
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              {CLIP_TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {clips.length > 0 && (
            <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground/60">
              {clips.length} clip{clips.length !== 1 ? 's' : ''}
            </div>
          )}
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
              <Film className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm font-medium">No clips found</p>
              {searchQuery && (
                <p className="text-xs mt-1">Try adjusting your search</p>
              )}
            </div>
          </div>
        ) : (
          <div className={`${CLIP_GRID_CLASS} pb-8`}>
            {clips.map((clip: MediaClipWithExpand) => (
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
