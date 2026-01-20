'use client';

import type { Media } from '@project/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty,
  EmptyHeader,
  EmptyMedia as EmptyMediaIcon,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import { Film } from 'lucide-react';
import { MediaCard } from './media-card';

interface MediaGalleryProps {
  media: Media[];
  isLoading?: boolean;
  onMediaClick?: (media: Media) => void;
  className?: string;
}

export function MediaGallery({
  media,
  isLoading = false,
  onMediaClick,
  className,
}: MediaGalleryProps) {
  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-48 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <span>Media Library</span>
            <Badge variant="secondary">{media.length}</Badge>
          </CardTitle>
        </div>
      </CardHeader>

      <CardContent>
        {media.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMediaIcon variant="icon">
                <Film className="h-6 w-6" />
              </EmptyMediaIcon>
              <EmptyTitle>No media yet</EmptyTitle>
              <EmptyDescription>
                Upload videos to see them in your media library
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {media.map((item) => (
              <MediaCard
                key={item.id}
                media={item}
                onClick={onMediaClick ? () => onMediaClick(item) : undefined}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
