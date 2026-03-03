'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { useMedia } from '@/hooks/use-media';
import { useMultiSelect } from '@/hooks/use-multi-select';
import { MediaProvider } from '@/contexts/media-context';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Film } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { MediaGallery } from '@/components/media';
import { DirectoryBrowser } from '@/components/media/directory-browser';
import type { Media } from '@project/shared';
import { toast } from 'sonner';

function MediaPageContent() {
  const {
    media,
    isLoading,
    directoryFilter,
    setDirectoryFilter,
    bulkDeleteMedia,
  } = useMedia();
  const { currentWorkspace } = useWorkspace();
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  const mediaIds = useMemo(() => media.map((m) => m.id), [media]);

  const {
    selectedIds,
    handleClick,
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
      // For plain clicks with modifier keys, the hook handles it.
      // For plain clicks without modifiers, we navigate (handled by onClick).
      if (action === 'single') {
        // Single modifier-less click on checkbox: toggle selection
        handleClick(mediaId, {
          ...e,
          metaKey: true,
        } as React.MouseEvent);
      }
    },
    [handleClick]
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

  if (!currentWorkspace) {
    return null;
  }

  return (
    <div className="container mx-auto px-4 pb-8 max-w-7xl">
      {/* Page Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-foreground mb-2 flex items-center gap-3">
              <Film className="h-8 w-8" />
              Media Gallery
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

      {/* Directory Browser */}
      <div className="mb-4">
        <DirectoryBrowser
          workspaceId={currentWorkspace.id}
          directoryFilter={directoryFilter}
          onDirectoryFilterChange={setDirectoryFilter}
        />
      </div>

      {/* Media Gallery */}
      <MediaGallery
        media={media}
        isLoading={isLoading}
        onMediaClick={handleMediaClick}
        directoryFilter={directoryFilter}
        selectedIds={selectedIds}
        onSelectionClick={handleSelectionClick}
        onSelectAll={selectAll}
        onClearSelection={clearSelection}
        onBulkDelete={handleBulkDelete}
        isDeleting={isDeleting}
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

  return (
    <MediaProvider workspaceId={currentWorkspace.id}>
      <MediaPageContent />
    </MediaProvider>
  );
}
