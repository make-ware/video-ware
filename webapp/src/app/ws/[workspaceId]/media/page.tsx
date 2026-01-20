'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { useMedia } from '@/hooks/use-media';
import { MediaProvider } from '@/contexts/media-context';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Film } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { MediaGallery } from '@/components/media';
import type { Media } from '@project/shared';

function MediaPageContent() {
  const { media, isLoading } = useMedia();
  const { currentWorkspace } = useWorkspace();
  const router = useRouter();

  const handleMediaClick = (media: Media) => {
    router.push(`/ws/${currentWorkspace?.id}/media/${media.id}`);
  };

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

      {/* Media Gallery */}
      <MediaGallery
        media={media}
        isLoading={isLoading}
        onMediaClick={handleMediaClick}
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
