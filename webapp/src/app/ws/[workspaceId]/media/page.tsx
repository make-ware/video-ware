'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { useMediaList } from '@/hooks/use-media-list';
import { useMultiSelect } from '@/hooks/use-multi-select';
import { useTagMediaBulk, useUntagMediaBulk } from '@/hooks/use-media-tags';
import { useProcessingMedia } from '@/hooks/use-processing-media';
import { useRegisterPageMenu } from '@/hooks/use-page-menu';
import type { PageMenuItem } from '@/contexts/page-menu-context';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Film, ListChecks, Search, X } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  MediaGallery,
  MediaTypeFilter,
  MediaEntityFilter,
  MEDIA_SORT_OPTIONS,
  DEFAULT_MEDIA_SORT,
  getMediaSortOption,
  type MediaSortValue,
} from '@/components/media';
import { DirectoryBrowser } from '@/components/media/directory-browser';
import type { Media } from '@project/shared';
import { MediaMutator } from '@project/shared/mutator';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';
import { MediaService } from '@/services/media';
import { toast } from 'sonner';

function MediaPageContent() {
  const { currentWorkspace } = useWorkspace();
  const processingMedia = useProcessingMedia(currentWorkspace?.id);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [directoryFilter, setDirectoryFilter] = useState<string | null>(
    searchParams.get('dir')
  );
  const [mediaTypeFilter, setMediaTypeFilter] = useState<string>(
    searchParams.get('type') ?? 'all'
  );
  const [entityFilter, setEntityFilter] = useState<string | null>(
    searchParams.get('entity')
  );
  const [sort, setSort] = useState<MediaSortValue>(
    getMediaSortOption(searchParams.get('sort')).value
  );
  // Search is transient (debounced input) and deliberately not URL-synced.
  const [searchQuery, setSearchQuery] = useState('');
  const mediaMutator = useMemo(() => new MediaMutator(pb), []);
  const mediaService = useMemo(() => new MediaService(pb), []);
  const tagMediaBulk = useTagMediaBulk();
  const untagMediaBulk = useUntagMediaBulk();

  const {
    items: media,
    totalItems,
    isLoading,
    hasNextPage,
    isFetchingNextPage,
    loadMore,
    removeFromCache,
  } = useMediaList({
    workspaceId: currentWorkspace?.id,
    directoryFilter,
    mediaTypeFilter,
    entityFilter,
    searchQuery,
    sort,
  });

  // Build a URL that preserves the directory, media-type, entity, and sort params
  const buildMediaUrl = useCallback(
    (
      dir: string | null,
      type: string,
      entity: string | null,
      sortValue: MediaSortValue
    ) => {
      const params = new URLSearchParams();
      // '' is the workspace root — only null (all directories) omits `dir`
      if (dir !== null) params.set('dir', dir);
      if (type && type !== 'all') params.set('type', type);
      if (entity) params.set('entity', entity);
      if (sortValue !== DEFAULT_MEDIA_SORT) params.set('sort', sortValue);
      const qs = params.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname]
  );

  // Sync URL → state when browser navigates back/forward
  useEffect(() => {
    const dirParam = searchParams.get('dir');
    if (dirParam !== directoryFilter) {
      setDirectoryFilter(dirParam);
    }
    const typeParam = searchParams.get('type') ?? 'all';
    if (typeParam !== mediaTypeFilter) {
      setMediaTypeFilter(typeParam);
    }
    const entityParam = searchParams.get('entity');
    if (entityParam !== entityFilter) {
      setEntityFilter(entityParam);
    }
    const sortParam = getMediaSortOption(searchParams.get('sort')).value;
    if (sortParam !== sort) {
      setSort(sortParam);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update URL when filters change (replaceState avoids Next.js soft navigation/remount)
  const handleDirectoryFilterChange = useCallback(
    (filter: string | null) => {
      setDirectoryFilter(filter);
      window.history.replaceState(
        null,
        '',
        buildMediaUrl(filter, mediaTypeFilter, entityFilter, sort)
      );
    },
    [buildMediaUrl, mediaTypeFilter, entityFilter, sort]
  );

  const handleMediaTypeFilterChange = useCallback(
    (type: string) => {
      setMediaTypeFilter(type);
      window.history.replaceState(
        null,
        '',
        buildMediaUrl(directoryFilter, type, entityFilter, sort)
      );
    },
    [buildMediaUrl, directoryFilter, entityFilter, sort]
  );

  const handleEntityFilterChange = useCallback(
    (entityId: string | null) => {
      setEntityFilter(entityId);
      window.history.replaceState(
        null,
        '',
        buildMediaUrl(directoryFilter, mediaTypeFilter, entityId, sort)
      );
    },
    [buildMediaUrl, directoryFilter, mediaTypeFilter, sort]
  );

  const handleSortChange = useCallback(
    (value: string) => {
      const sortValue = getMediaSortOption(value).value;
      setSort(sortValue);
      window.history.replaceState(
        null,
        '',
        buildMediaUrl(directoryFilter, mediaTypeFilter, entityFilter, sortValue)
      );
    },
    [buildMediaUrl, directoryFilter, mediaTypeFilter, entityFilter]
  );

  const mediaIds = useMemo(() => media.map((m) => m.id), [media]);

  const {
    selectedIds,
    handleClick,
    toggleItem,
    selectAll,
    clearSelection,
    selectionCount,
  } = useMultiSelect({ items: mediaIds });

  const handleMediaClick = (clickedMedia: Media) => {
    router.push(`/ws/${currentWorkspace?.id}/media/${clickedMedia.id}`);
  };

  const handleSelectionClick = useCallback(
    (mediaId: string, e: React.MouseEvent) => {
      const action = handleClick(mediaId, e);
      if (action === 'single') {
        toggleItem(mediaId);
      }
    },
    [handleClick, toggleItem]
  );

  const handleBulkDelete = useCallback(async () => {
    if (selectionCount === 0) return;

    setIsDeleting(true);
    try {
      const result = await mediaService.bulkDeleteMedia(
        Array.from(selectedIds)
      );
      clearSelection();
      // Drop the deleted rows immediately; the invalidation trues up the
      // server totals. SSE delete echoes then no-op (already absent).
      removeFromCache(result.succeeded);
      await queryClient.invalidateQueries({ queryKey: qk.media.lists });

      if (result.failed.length > 0) {
        toast.error(
          `Deleted ${result.succeeded.length}, failed ${result.failed.length}`
        );
      } else {
        toast.success(
          `Deleted ${result.succeeded.length} media ${result.succeeded.length === 1 ? 'item' : 'items'}`
        );
      }
    } catch {
      toast.error('Failed to delete media');
    } finally {
      setIsDeleting(false);
    }
  }, [
    selectedIds,
    selectionCount,
    mediaService,
    clearSelection,
    removeFromCache,
    queryClient,
  ]);

  const handleBulkMove = useCallback(
    async (directoryId: string | null) => {
      if (selectionCount === 0) return;

      setIsMoving(true);
      try {
        const ids = Array.from(selectedIds);
        await Promise.all(
          ids.map((id) =>
            mediaMutator.update(id, { DirectoryRef: directoryId ?? '' })
          )
        );
        clearSelection();
        await queryClient.invalidateQueries({ queryKey: qk.media.lists });
        toast.success(
          `Moved ${ids.length} ${ids.length === 1 ? 'item' : 'items'}`
        );
      } catch {
        toast.error('Failed to move media');
      } finally {
        setIsMoving(false);
      }
    },
    [selectedIds, selectionCount, mediaMutator, clearSelection, queryClient]
  );

  const handleBulkTag = useCallback(
    async (entityId: string) => {
      if (selectionCount === 0 || !currentWorkspace) return;
      // The mutation's onError already toasts; swallow so the caller's
      // fire-and-forget invocation never rejects unhandled.
      const result = await tagMediaBulk
        .mutateAsync({
          workspaceId: currentWorkspace.id,
          mediaIds: Array.from(selectedIds),
          entityId,
        })
        .catch(() => null);
      if (!result) return;
      clearSelection();
      // Only the entity-filtered list can change membership on a tag write.
      if (entityFilter) {
        await queryClient.invalidateQueries({ queryKey: qk.media.lists });
      }
    },
    [
      selectedIds,
      selectionCount,
      currentWorkspace,
      tagMediaBulk,
      clearSelection,
      entityFilter,
      queryClient,
    ]
  );

  const handleBulkUntag = useCallback(
    async (entityId: string) => {
      if (selectionCount === 0) return;
      const result = await untagMediaBulk
        .mutateAsync({ mediaIds: Array.from(selectedIds), entityId })
        .catch(() => null);
      if (!result) return;
      clearSelection();
      if (entityFilter) {
        await queryClient.invalidateQueries({ queryKey: qk.media.lists });
      }
    },
    [
      selectedIds,
      selectionCount,
      untagMediaBulk,
      clearSelection,
      entityFilter,
      queryClient,
    ]
  );

  // Contribute selection actions to the nav bar Edit menu.
  const editMenuItems = useMemo<PageMenuItem[]>(
    () => [
      {
        id: 'select-all',
        label: 'Select All',
        icon: ListChecks,
        disabled: mediaIds.length === 0,
        onSelect: selectAll,
      },
      {
        id: 'clear-selection',
        label: 'Clear Selection',
        icon: X,
        disabled: selectionCount === 0,
        onSelect: clearSelection,
      },
    ],
    [mediaIds.length, selectionCount, selectAll, clearSelection]
  );

  useRegisterPageMenu('edit', editMenuItems);

  if (!currentWorkspace) {
    return null;
  }

  return (
    <div className="container mx-auto px-3 pt-4 pb-8 sm:px-4 sm:pt-6 max-w-7xl">
      {/* Page Header */}
      <div className="mb-4 sm:mb-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-4xl font-bold text-foreground mb-1 sm:mb-2 flex items-center gap-2 sm:gap-3">
              <Film className="h-6 w-6 sm:h-8 sm:w-8" />
              Media
            </h1>
            <p className="text-sm sm:text-lg text-muted-foreground">
              Browse and manage your processed media in {currentWorkspace.name}
            </p>
          </div>
          <Link
            href={`/ws/${currentWorkspace.id}/uploads`}
            className="sm:shrink-0"
          >
            <Button className="w-full sm:w-auto">Upload New Files</Button>
          </Link>
        </div>
      </div>

      {/* Filters: directory browser + search + sort + media type */}
      <div className="mb-4 flex flex-col gap-3">
        <DirectoryBrowser
          workspaceId={currentWorkspace.id}
          directoryFilter={directoryFilter}
          onDirectoryFilterChange={handleDirectoryFilterChange}
        />
        {/* Search takes its own row on phones; the three selects share a
            two-column grid rather than overflowing a single flex row. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search media..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <Select value={sort} onValueChange={handleSortChange}>
              <SelectTrigger className="w-full sm:w-[150px] h-9">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                {MEDIA_SORT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <MediaTypeFilter
              value={mediaTypeFilter}
              onChange={handleMediaTypeFilterChange}
              className="w-full sm:w-[150px] h-9 text-sm"
            />
            <MediaEntityFilter
              workspaceId={currentWorkspace.id}
              value={entityFilter}
              onChange={handleEntityFilterChange}
              className="col-span-2 w-full sm:col-span-1 sm:w-[170px] h-9 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Media */}
      <MediaGallery
        media={media}
        isLoading={isLoading}
        onMediaClick={handleMediaClick}
        directoryFilter={directoryFilter}
        mediaTypeFilter={mediaTypeFilter}
        entityFilterActive={!!entityFilter}
        searchActive={searchQuery.trim().length > 0}
        processingMedia={processingMedia}
        totalItems={totalItems}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        onLoadMore={loadMore}
        selectedIds={selectedIds}
        onSelectionClick={handleSelectionClick}
        onSelectAll={selectAll}
        onClearSelection={clearSelection}
        onBulkDelete={handleBulkDelete}
        onBulkMove={handleBulkMove}
        onBulkTag={handleBulkTag}
        onBulkUntag={handleBulkUntag}
        isDeleting={isDeleting}
        isMoving={isMoving}
        isTagging={tagMediaBulk.isPending || untagMediaBulk.isPending}
        workspaceId={currentWorkspace.id}
      />
    </div>
  );
}

export default function MediaPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentWorkspace, isLoading: workspaceLoading } = useWorkspace();

  // Show loading state
  if (authLoading || workspaceLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Authentication Required</AlertTitle>
          <AlertDescription>
            Please{' '}
            <Link href="/login" className="underline">
              log in
            </Link>{' '}
            to access media.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Show workspace selection prompt if no workspace selected
  if (!currentWorkspace) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Workspace Required</AlertTitle>
          <AlertDescription>
            Please select a workspace from the navigation bar to view media.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return <MediaPageContent />;
}
