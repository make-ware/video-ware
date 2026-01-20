'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMediaDetails } from '@/hooks/use-media-details';
import { MediaDetailsEditor } from '@/components/media/media-details-editor';
import { MediaPreviewFiles } from '@/components/media/media-preview-files';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Sparkles, Tag } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import pb from '@/lib/pocketbase-client';
import { MediaService } from '@/services';

export default function MediaDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params.workspaceId as string;
  const id = params.id as string;
  const { media, isLoading, error, refresh, hasActiveLabelTask } =
    useMediaDetails(id);
  const [isDetectingLabels, setIsDetectingLabels] = useState(false);

  const handleBack = () => {
    router.push(`/ws/${workspaceId}/media/${id}`);
  };

  const handleDetectLabels = async () => {
    if (!media) return;

    setIsDetectingLabels(true);

    try {
      const mediaService = new MediaService(pb);
      const task = await mediaService.createTaskForLabel(media.id);

      toast.success('Label Detection Started', {
        description: `Task ${task.id} has been queued. Labels will be detected automatically.`,
      });

      // Refresh to update the button state
      refresh();
    } catch (error) {
      console.error('Failed to start label detection:', error);
      toast.error('Failed to start label detection', {
        description:
          error instanceof Error ? error.message : 'An unknown error occurred',
      });
    } finally {
      setIsDetectingLabels(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (error || !media) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Button variant="ghost" className="mb-4" onClick={handleBack}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Media Viewer
        </Button>
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            {error?.message || 'Media not found'}
          </AlertDescription>
        </Alert>
        <Button className="mt-4" onClick={() => refresh()}>
          <RefreshCw className="mr-2 h-4 w-4" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={handleBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">
              {media.expand?.UploadRef?.name || 'Untitled Media'} - Details
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Edit media metadata and manage preview files
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDetectLabels}
            disabled={isDetectingLabels || hasActiveLabelTask}
          >
            <Sparkles className="h-4 w-4 mr-2" />
            {isDetectingLabels || hasActiveLabelTask
              ? 'Detecting...'
              : 'Detect Labels'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              router.push(`/ws/${workspaceId}/media/${id}/labels/objects`)
            }
          >
            <Tag className="h-4 w-4 mr-2" />
            Inspector
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="space-y-6">
        <MediaDetailsEditor media={media} onUpdate={refresh} />
        <MediaPreviewFiles media={media} onUpdate={refresh} />
      </div>
    </div>
  );
}
