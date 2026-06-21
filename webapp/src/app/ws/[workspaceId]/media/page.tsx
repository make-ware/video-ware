'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { useMedia } from '@/hooks/use-media';
import { useMultiSelect } from '@/hooks/use-multi-select';
import { useProcessingMedia } from '@/hooks/use-processing-media';
import { MediaProvider } from '@/contexts/media-context';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Film } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  MediaGallery,
  MediaTypeFilter,
  mediaTypeFilterPredicate,
} from '@/components/media';
import { DirectoryBrowser } from '@/components/media/directory-browser';
import type { Media } from '@project/shared';
import { MediaMutator } from '@project/shared/mutator';
import pb from '@/lib/pocketbase-client';
import { toast } from 'sonner';

function MediaPageContent() {
  const {
    media,
    isLoading,
    directoryFilter,
    setDirectoryFilter,
    bulkDeleteMedia,
    refreshMedia,
  } = useMedia();
  const { currentWorkspace } = useWorkspace();
  const processingMedia = useProcessingMedia(currentWorkspace?.id);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [mediaTypeFilter, setMediaTypeFilter] = useState<string>(
    searchParams.get('type') ?? 'all'
  );
  const mediaMutator = useMemo(() => new MediaMutator(pb), []);

  // Build a URL that preserves both the directory and media-type filters
  const buildMediaUrl = useCallback(
    (dir: string | null, type: string) => {
      const params = new URLSearchParams();
      if (dir) params.set('dir', dir);
      if (type && type !== 'all') params.set('type', type);
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
  }, [searchParams, setDirectoryFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update URL when directory filter changes (replaceState avoids Next.js soft navigation/remount)
  const handleDirectoryFilterChange = useCallback(
    (filter: string | null) => {
      setDirectoryFilter(filter);
      window.history.replaceState(
        null,
        '',
        buildMediaUrl(filter, mediaTypeFilter)
      );
    },
    [setDirectoryFilter, buildMediaUrl, mediaTypeFilter]
  );

  const handleMediaTypeFilterChange = useCallback(
    (type: string) => {
      setMediaTypeFilter(type);
      window.history.replaceState(
        null,
        '',
        buildMediaUrl(directoryFilter, type)
      );
    },
    [buildMediaUrl, directoryFilter]
  );

  const filteredMedia = useMemo(() => {
    const predicate = mediaTypeFilterPredicate(mediaTypeFilter);
    return media.filter((m) => predicate(m.mediaType));
  }, [media, mediaTypeFilter]);

  const mediaIds = useMemo(
    () => filteredMedia.map((m) => m.id),
    [filteredMedia]
  );

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
      const result = await bulkDeleteMedia(Array.from(selectedIds));
      clearSelection();

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
  }, [selectedIds, selectionCount, bulkDeleteMedia, clearSelection]);

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
        await refreshMedia();
        toast.success(
          `Moved ${ids.length} ${ids.length === 1 ? 'item' : 'items'}`
        );
      } catch {
        toast.error('Failed to move media');
      } finally {
        setIsMoving(false);
      }
    },
    [selectedIds, selectionCount, mediaMutator, clearSelection, refreshMedia]
  );

  if (!currentWorkspace) {
    return null;
  }

  return (
    <div className="container mx-auto px-4 pt-6 pb-8 max-w-7xl">
      {/* Page Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-foreground mb-2 flex items-center gap-3">
              <Film className="h-8 w-8" />
              Media
            </h1>
            <p className="text-lg text-muted-foreground">
              Browse and manage your processed media in {currentWorkspace.name}
            </p>
          </div>
          <Link href={`/ws/${currentWorkspace.id}/uploads`}>
            <Button>Upload New Files</Button>
          </Link>
        </div>
      </div>

      {/* Filters: directory browser + media type */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <DirectoryBrowser
            workspaceId={currentWorkspace.id}
            directoryFilter={directoryFilter}
            onDirectoryFilterChange={handleDirectoryFilterChange}
          />
        </div>
        <MediaTypeFilter
          value={mediaTypeFilter}
          onChange={handleMediaTypeFilterChange}
        />
      </div>

      {/* Media */}
      <MediaGallery
        media={filteredMedia}
        isLoading={isLoading}
        onMediaClick={handleMediaClick}
        directoryFilter={directoryFilter}
        mediaTypeFilter={mediaTypeFilter}
        processingMedia={processingMedia}
        selectedIds={selectedIds}
        onSelectionClick={handleSelectionClick}
        onSelectAll={selectAll}
        onClearSelection={clearSelection}
        onBulkDelete={handleBulkDelete}
        onBulkMove={handleBulkMove}
        isDeleting={isDeleting}
        isMoving={isMoving}
        workspaceId={currentWorkspace.id}
      />
    </div>
  );
}

export default function MediaPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentWorkspace, isLoading: workspaceLoading } = useWorkspace();
  const searchParams = useSearchParams();

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

  return (
    <MediaProvider
      workspaceId={currentWorkspace.id}
      initialDirectoryFilter={searchParams.get('dir')}
    >
      <MediaPageContent />
    </MediaProvider>
  );
}
