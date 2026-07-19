'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { mediaTypeSupportsLabels } from '@project/shared';
import { Button } from '@/components/ui/button';
import { MediaTypeIcon, normalizeMediaType } from '@/components/media';
import { useMediaDetails } from '@/hooks/use-media-details';

export default function LabelsPage() {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params.workspaceId as string;
  const mediaId = params.id as string;
  const { media, isLoading } = useMediaDetails(mediaId);
  const mediaType = normalizeMediaType(media?.mediaType);
  const supportsLabels = mediaType ? mediaTypeSupportsLabels(mediaType) : true;

  // Speakers is a valid first tab for both video and audio; images have no
  // labels at all, so they render the message below instead of redirecting.
  useEffect(() => {
    if (!isLoading && media && supportsLabels) {
      router.replace(`/ws/${workspaceId}/media/${mediaId}/labels/speakers`);
    }
  }, [isLoading, media, supportsLabels, router, workspaceId, mediaId]);

  if (!isLoading && media && !supportsLabels) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <MediaTypeIcon
          mediaType={media.mediaType}
          className="h-12 w-12 text-muted-foreground/50"
        />
        <div>
          <p className="text-lg font-medium">
            Labels aren&apos;t available for images
          </p>
          <p className="text-sm text-muted-foreground">
            Label detection runs on video and audio media.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => router.push(`/ws/${workspaceId}/media/${mediaId}`)}
        >
          Back to media
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
}
