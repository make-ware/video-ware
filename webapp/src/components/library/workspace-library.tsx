'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Film, FolderOpen, Scissors, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ClipEditorModal } from '@/components/clip/clip-editor-modal';
import { CLIP_GRID_CLASS } from '@/components/timeline/constants';
import { useWorkspace } from '@/hooks/use-workspace';
import { useTimeline } from '@/hooks/use-timeline';
import { useDirectories } from '@/hooks/use-directories';
import type { Media, MediaClip } from '@project/shared';
import { LibraryToolbar } from './library-toolbar';
import { LibraryItemCard } from './library-item-card';
import { useClipLibrary } from './use-clip-library';
import type { LibrarySortBy } from './types';
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
  const { directories, currentDirectory, breadcrumbs, navigateTo } =
    useDirectories(currentWorkspace?.id ?? '');

  // Sync directory tree to match directoryFilter prop on initial mount / url change
  useEffect(() => {
    const currentId = currentDirectory?.id ?? null;
    if (directoryFilter !== currentId) {
      navigateTo(directoryFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directoryFilter]);

  const handleDirectorySelect = useCallback(
    (dirId: string | null) => {
      navigateTo(dirId);
      onDirectoryFilterChange?.(dirId);
    },
    [navigateTo, onDirectoryFilterChange]
  );

  const directoryFilterId = currentDirectory?.id ?? undefined;

  const [activeTab, setActiveTab] = useState<'media' | 'clips'>('media');

  // Clips tab state
  const [clipSearch, setClipSearch] = useState('');
  const [clipSort, setClipSort] = useState<LibrarySortBy>('recent');
  const [clipTypeFilter, setClipTypeFilter] = useState('all');

  // Media tab state
  const [mediaSearch, setMediaSearch] = useState('');
  const [mediaSort, setMediaSort] = useState<LibrarySortBy>('recent');

  // Carve-from-media (ClipEditorModal in create mode)
  const [carveMedia, setCarveMedia] = useState<
    Media | ExpandedMedia | MediaWithPreviews | null
  >(null);

  const clipsLib = useClipLibrary({
    source: currentWorkspace
      ? {
          kind: 'workspace-clips',
          workspaceId: currentWorkspace.id,
          directoryId: directoryFilterId,
        }
      : null,
    searchQuery: clipSearch,
    typeFilter: clipTypeFilter,
    sortBy: clipSort,
  });

  const mediaLib = useClipLibrary({
    source: currentWorkspace
      ? {
          kind: 'workspace-media',
          workspaceId: currentWorkspace.id,
          directoryId: directoryFilterId,
        }
      : null,
    searchQuery: mediaSearch,
    sortBy: mediaSort,
  });

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
            <TabsTrigger value="media" className="flex-1 gap-1.5">
              <Video className="h-4 w-4" />
              Media
            </TabsTrigger>
            <TabsTrigger value="clips" className="flex-1 gap-1.5">
              <Scissors className="h-4 w-4" />
              Clips
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
            onSortChange={setMediaSort}
            searchPlaceholder="Search media..."
            itemCount={mediaLib.items.length}
            itemLabel="media"
            directories={directories}
            currentDirectory={currentDirectory}
            breadcrumbs={breadcrumbs}
            onDirectorySelect={handleDirectorySelect}
          />
          <LibraryGrid
            isLoading={mediaLib.isLoading}
            error={mediaLib.error}
            emptyIcon={currentDirectory ? FolderOpen : Film}
            emptyMessage={
              currentDirectory ? 'No media in this folder' : 'No media found'
            }
            hasSearch={mediaSearch.length > 0}
            onClearDirectory={() => handleDirectorySelect(null)}
            inDirectory={!!currentDirectory}
          >
            {mediaLib.items.map((item) => (
              <LibraryItemCard
                key={item.id}
                item={item}
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
            onSortChange={setClipSort}
            typeFilter={clipTypeFilter}
            onTypeFilterChange={setClipTypeFilter}
            searchPlaceholder="Search clips..."
            itemCount={clipsLib.items.length}
            itemLabel="clip"
            directories={directories}
            currentDirectory={currentDirectory}
            breadcrumbs={breadcrumbs}
            onDirectorySelect={handleDirectorySelect}
          />
          <LibraryGrid
            isLoading={clipsLib.isLoading}
            error={clipsLib.error}
            emptyIcon={currentDirectory ? FolderOpen : Film}
            emptyMessage={
              currentDirectory ? 'No clips in this folder' : 'No clips found'
            }
            hasSearch={clipSearch.length > 0}
            onClearDirectory={() => handleDirectorySelect(null)}
            inDirectory={!!currentDirectory}
          >
            {clipsLib.items.map((item) => (
              <LibraryItemCard
                key={item.id}
                item={item}
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
            <ItemSkeleton key={i} />
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
        <div className={`${CLIP_GRID_CLASS} pb-8`}>{children}</div>
      )}
    </div>
  );
}

function ItemSkeleton() {
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
