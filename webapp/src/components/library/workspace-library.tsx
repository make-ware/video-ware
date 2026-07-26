'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Film, FolderOpen, Scissors, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LibraryLoadMore, LibraryItemSkeleton } from './library-load-more';
import { ClipEditorModal } from '@/components/clip/clip-editor-modal';
import { CLIP_GRID_CLASS } from '@/components/timeline/constants';
import { useWorkspace } from '@/hooks/use-workspace';
import { useTimeline } from '@/hooks/use-timeline';
import { useDirectories } from '@/hooks/use-directories';
import { useMediaList } from '@/hooks/use-media-list';
import { useClipList } from '@/hooks/use-clip-list';
import {
  MEDIA_SORT_OPTIONS,
  DEFAULT_MEDIA_SORT,
  getMediaSortOption,
  type MediaSortValue,
} from '@/components/media/media-sort';
import {
  CLIP_SORT_OPTIONS,
  DEFAULT_CLIP_SORT,
  getClipSortOption,
  type ClipSortValue,
} from '@/components/clip/clip-sort';
import type { Media, MediaClip } from '@project/shared';
import { LibraryToolbar } from './library-toolbar';
import { LibraryItemCard } from './library-item-card';
import type { ExpandedMedia, ExpandedMediaClip } from '@/types/expanded-types';
import type { MediaWithPreviews } from '@/services/media';

interface WorkspaceLibraryProps {
  directoryFilter?: string | null;
  onDirectoryFilterChange?: (filter: string | null) => void;
}

export function WorkspaceLibrary({
  directoryFilter = null,
  onDirectoryFilterChange,
}: WorkspaceLibraryProps) {
  const { currentWorkspace } = useWorkspace();
  const { addClip } = useTimeline();
  const { directories } = useDirectories(currentWorkspace?.id ?? '');

  const handleDirectorySelect = useCallback(
    (dirId: string | null) => {
      onDirectoryFilterChange?.(dirId);
    },
    [onDirectoryFilterChange]
  );

  const inDirectory = directoryFilter !== null;

  const [activeTab, setActiveTab] = useState<'media' | 'clips'>('clips');

  // Clips tab state
  const [clipSearch, setClipSearch] = useState('');
  const [clipSort, setClipSort] = useState<ClipSortValue>(DEFAULT_CLIP_SORT);
  const [clipMediaType, setClipMediaType] = useState('all');
  // Clip-type filter ('all' | ClipType). Defaults to all so CLI/label-derived
  // clips (object, face, speech, shot, …) are visible, not just user clips.
  const [clipType, setClipType] = useState('all');

  // Media tab state
  const [mediaSearch, setMediaSearch] = useState('');
  const [mediaSort, setMediaSort] =
    useState<MediaSortValue>(DEFAULT_MEDIA_SORT);
  const [mediaMediaType, setMediaMediaType] = useState('all');

  // Carve-from-media (ClipEditorModal in create mode)
  const [carveMedia, setCarveMedia] = useState<
    Media | ExpandedMedia | MediaWithPreviews | null
  >(null);

  // Both tabs stay mounted, so both live lists stay subscribed — PocketBase
  // multiplexes them over its single realtime connection.
  const clipsLib = useClipList({
    workspaceId: currentWorkspace?.id,
    // The library browses the whole workspace; media scoping is the viewer's.
    mediaId: null,
    directoryFilter,
    clipTypeFilter: clipType,
    mediaTypeFilter: clipMediaType,
    searchQuery: clipSearch,
    sort: clipSort,
  });

  const mediaLib = useMediaList({
    workspaceId: currentWorkspace?.id,
    directoryFilter,
    mediaTypeFilter: mediaMediaType,
    // The library browses everything; entity filtering lives on the media page.
    entityFilter: null,
    searchQuery: mediaSearch,
    sort: mediaSort,
  });

  const handleClipSortChange = useCallback((value: string) => {
    setClipSort(getClipSortOption(value).value);
  }, []);

  const handleMediaSortChange = useCallback((value: string) => {
    setMediaSort(getMediaSortOption(value).value);
  }, []);

  const handleAddClipToTimeline = useCallback(
    async (clip: ExpandedMediaClip | MediaClip) => {
      try {
        await addClip(clip.MediaRef, clip.start, clip.end, clip.id);
      } catch (err) {
        console.error('Failed to add clip:', err);
      }
    },
    [addClip]
  );

  const handleAddMediaToTimeline = useCallback(
    async (media: ExpandedMedia | MediaWithPreviews) => {
      try {
        await addClip(media.id, 0, media.duration);
      } catch (err) {
        console.error('Failed to add media to timeline:', err);
      }
    },
    [addClip]
  );

  const handleCarveClipFromMedia = useCallback(
    (media: ExpandedMedia | MediaWithPreviews) => {
      setCarveMedia(media);
    },
    []
  );

  const handleCarveAddToTimeline = useCallback(
    async (
      mediaId: string,
      start: number,
      end: number,
      mediaClipId: string
    ) => {
      await addClip(mediaId, start, end, mediaClipId);
      clipsLib.reload();
    },
    [addClip, clipsLib]
  );

  const handleCarveClipCreated = useCallback(() => {
    clipsLib.reload();
  }, [clipsLib]);

  const carveMediaAsMedia = useMemo<Media | undefined>(() => {
    if (!carveMedia) return undefined;
    return carveMedia as Media;
  }, [carveMedia]);

  if (!currentWorkspace) {
    return (
      <div className="p-4 h-full flex items-center justify-center">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Select a workspace to browse your library.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <>
      <Tabs
        value={activeTab}
        onValueChange={(val) => setActiveTab(val as 'media' | 'clips')}
        className="h-full flex flex-col"
      >
        <div className="px-4 pt-3 pb-0 flex-shrink-0">
          <TabsList className="w-full">
            <TabsTrigger value="clips" className="flex-1 gap-1.5">
              <Scissors className="h-4 w-4" />
              Clips
            </TabsTrigger>
            <TabsTrigger value="media" className="flex-1 gap-1.5">
              <Video className="h-4 w-4" />
              Media
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="media"
          className="flex-1 flex flex-col overflow-hidden mt-2 data-[state=inactive]:hidden"
        >
          <LibraryToolbar
            searchQuery={mediaSearch}
            onSearchChange={setMediaSearch}
            sortBy={mediaSort}
            onSortChange={handleMediaSortChange}
            sortOptions={MEDIA_SORT_OPTIONS}
            mediaTypeFilter={mediaMediaType}
            onMediaTypeFilterChange={setMediaMediaType}
            searchPlaceholder="Search media..."
            totalItems={mediaLib.isLoading ? undefined : mediaLib.totalItems}
            itemLabel="media"
            itemLabelPlural="media"
            directories={directories}
            directoryFilter={directoryFilter}
            onDirectorySelect={handleDirectorySelect}
          />
          <LibraryGrid
            isLoading={mediaLib.isLoading}
            error={mediaLib.error}
            emptyIcon={inDirectory ? FolderOpen : Film}
            emptyMessage={
              inDirectory ? 'No media in this folder' : 'No media found'
            }
            hasSearch={mediaSearch.length > 0}
            onClearDirectory={() => handleDirectorySelect(null)}
            inDirectory={inDirectory}
            loadedCount={mediaLib.items.length}
            totalItems={mediaLib.totalItems}
            hasNextPage={mediaLib.hasNextPage}
            isFetchingNextPage={mediaLib.isFetchingNextPage}
            onLoadMore={mediaLib.loadMore}
          >
            {mediaLib.items.map((media) => (
              <LibraryItemCard
                key={media.id}
                item={{ kind: 'media', id: media.id, media }}
                surface="timeline"
                onAddMediaToTimeline={handleAddMediaToTimeline}
                onCarveClipFromMedia={handleCarveClipFromMedia}
              />
            ))}
          </LibraryGrid>
        </TabsContent>

        <TabsContent
          value="clips"
          className="flex-1 flex flex-col overflow-hidden mt-2 data-[state=inactive]:hidden"
        >
          <LibraryToolbar
            searchQuery={clipSearch}
            onSearchChange={setClipSearch}
            sortBy={clipSort}
            onSortChange={handleClipSortChange}
            sortOptions={CLIP_SORT_OPTIONS}
            clipTypeFilter={clipType}
            onClipTypeFilterChange={setClipType}
            mediaTypeFilter={clipMediaType}
            onMediaTypeFilterChange={setClipMediaType}
            searchPlaceholder="Search clips..."
            totalItems={clipsLib.isLoading ? undefined : clipsLib.totalItems}
            itemLabel="clip"
            directories={directories}
            directoryFilter={directoryFilter}
            onDirectorySelect={handleDirectorySelect}
          />
          <LibraryGrid
            isLoading={clipsLib.isLoading}
            error={clipsLib.error}
            emptyIcon={inDirectory ? FolderOpen : Film}
            emptyMessage={
              inDirectory ? 'No clips in this folder' : 'No clips found'
            }
            hasSearch={clipSearch.length > 0}
            onClearDirectory={() => handleDirectorySelect(null)}
            inDirectory={inDirectory}
            loadedCount={clipsLib.items.length}
            totalItems={clipsLib.totalItems}
            hasNextPage={clipsLib.hasNextPage}
            isFetchingNextPage={clipsLib.isFetchingNextPage}
            onLoadMore={clipsLib.loadMore}
          >
            {clipsLib.items.map((clip) => (
              <LibraryItemCard
                key={clip.id}
                item={{ kind: 'clip', id: clip.id, clip }}
                surface="timeline"
                onAddClipToTimeline={handleAddClipToTimeline}
              />
            ))}
          </LibraryGrid>
        </TabsContent>
      </Tabs>

      {carveMediaAsMedia && (
        <ClipEditorModal
          key={`carve-${carveMediaAsMedia.id}`}
          open
          onOpenChange={(open) => {
            if (!open) setCarveMedia(null);
          }}
          mode="create"
          media={carveMediaAsMedia}
          onClipCreated={handleCarveClipCreated}
          onAddToTimeline={handleCarveAddToTimeline}
        />
      )}
    </>
  );
}

interface LibraryGridProps {
  isLoading: boolean;
  error: string | null;
  emptyIcon: React.ElementType;
  emptyMessage: string;
  hasSearch: boolean;
  onClearDirectory: () => void;
  inDirectory: boolean;
  /** Rows currently in the cache; the "X" of "Showing X of Y". */
  loadedCount: number;
  /** Server-side total for the current filters; the "Y". */
  totalItems: number;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  children: React.ReactNode;
}

function LibraryGrid({
  isLoading,
  error,
  emptyIcon: EmptyIcon,
  emptyMessage,
  hasSearch,
  onClearDirectory,
  inDirectory,
  loadedCount,
  totalItems,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  children,
}: LibraryGridProps) {
  const childrenCount = React.Children.count(children);

  return (
    <div
      className="flex-1 overflow-y-auto px-4 py-4"
      style={{ scrollbarWidth: 'thin' }}
    >
      {isLoading && childrenCount === 0 ? (
        <div className={CLIP_GRID_CLASS}>
          {Array.from({ length: 6 }).map((_, i) => (
            <LibraryItemSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <div className="h-full flex items-center justify-center">
          <Alert variant="destructive" className="max-w-md">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      ) : childrenCount === 0 ? (
        <div className="h-full flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <EmptyIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm font-medium">{emptyMessage}</p>
            {hasSearch && (
              <p className="text-xs mt-1">Try adjusting your search</p>
            )}
            {inDirectory && !hasSearch && (
              <Button
                variant="link"
                size="sm"
                className="text-xs mt-1"
                onClick={onClearDirectory}
              >
                Show all folders
              </Button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className={CLIP_GRID_CLASS}>{children}</div>
          <LibraryLoadMore
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            loadedCount={loadedCount}
            totalItems={totalItems}
            onLoadMore={onLoadMore}
          />
          {!hasNextPage && <div className="pb-8" />}
        </>
      )}
    </div>
  );
}
