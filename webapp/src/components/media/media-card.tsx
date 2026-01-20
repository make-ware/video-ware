import { useState } from 'react';
import Image from 'next/image';
import type { Media, MediaRelations, Expanded } from '@project/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Film, Clock, Maximize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import pb from '@/lib/pocketbase-client';
import { SpriteAnimator } from '../sprite/sprite-animator';

interface MediaCardProps<
  E extends keyof MediaRelations = keyof MediaRelations,
> {
  media: Media | Expanded<Media, MediaRelations, E>;
  onClick?: () => void;
  className?: string;
  compact?: boolean;
}

export function MediaCard({
  media,
  onClick,
  className,
  compact = false,
}: MediaCardProps) {
  const [isHovering, setIsHovering] = useState(false);

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDimensions = (width?: number, height?: number): string => {
    if (!width || !height) return 'Unknown';
    return `${width}×${height}`;
  };

  const getCodec = (): string => {
    if (media.mediaData && typeof media.mediaData === 'object') {
      const data = media.mediaData as Record<string, unknown>;
      return (data.codec as string) || 'Unknown';
    }
    return 'Unknown';
  };

  const getDimensions = (): { width?: number; height?: number } => {
    if (media.mediaData && typeof media.mediaData === 'object') {
      const data = media.mediaData as Record<string, unknown>;
      return {
        width: data.width as number | undefined,
        height: data.height as number | undefined,
      };
    }
    return {};
  };

  // Get thumbnail URL
  const getThumbnailUrl = (): string | null => {
    if (!('expand' in media) || !media.expand) return null;
    const thumbnailFile =
      'thumbnailFileRef' in media.expand
        ? media.expand.thumbnailFileRef
        : undefined;
    if (!thumbnailFile || !thumbnailFile.file) return null;

    try {
      return pb.files.getURL(thumbnailFile, thumbnailFile.file);
    } catch (error) {
      console.error('Failed to get thumbnail URL:', error);
      return null;
    }
  };

  const thumbnailUrl = getThumbnailUrl();
  const dimensions = getDimensions();

  // Get title from upload name (check both possible expand paths)
  const uploadName =
    ('expand' in media &&
      media.expand &&
      'UploadRef' in media.expand &&
      media.expand.UploadRef?.name) ||
    'Untitled Media';

  return (
    <Card
      className={cn(
        'overflow-hidden cursor-pointer transition-all hover:shadow-lg',
        'p-0 gap-0', // Remove default Card padding and gap
        className
      )}
      onClick={onClick}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* Thumbnail/Sprite preview */}
      <div
        className={cn(
          'relative bg-muted overflow-hidden',
          compact ? 'h-20' : 'aspect-video'
        )}
      >
        {thumbnailUrl ? (
          <>
            {/* Static thumbnail */}
            <Image
              src={thumbnailUrl}
              alt={`Thumbnail for media ${media.id}`}
              fill
              className={cn(
                'object-cover transition-opacity',
                isHovering ? 'opacity-0' : 'opacity-100'
              )}
              unoptimized
            />

            {/* Sprite sheet preview on hover */}
            {isHovering && (
              <SpriteAnimator
                media={media}
                spriteFile={
                  'expand' in media &&
                  media.expand &&
                  'spriteFileRef' in media.expand
                    ? media.expand.spriteFileRef
                    : undefined
                }
                isHovering={isHovering}
                className="absolute inset-0"
                fallbackIcon={<div className="h-full w-full" />}
              />
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <Film
              className={cn(
                compact ? 'h-6 w-6' : 'h-12 w-12',
                'text-muted-foreground'
              )}
            />
          </div>
        )}

        {/* Duration badge */}
        <div
          className={cn(
            'absolute',
            compact ? 'bottom-1 right-1' : 'bottom-2 right-2'
          )}
        >
          <Badge
            variant="secondary"
            className={cn(
              'bg-black/80 text-white',
              compact && 'text-[10px] px-1 py-0'
            )}
          >
            {!compact && <Clock className="h-3 w-3 mr-1" />}
            {formatDuration(media.duration)}
          </Badge>
        </div>
      </div>

      {/* Media info */}
      <CardContent
        className={cn(compact ? 'p-1.5 space-y-1' : 'p-3 space-y-2')}
      >
        {/* Title - truncates to fit card width */}
        <h3
          className={cn(
            'font-semibold text-foreground truncate leading-tight',
            compact ? 'text-xs' : 'text-sm'
          )}
          title={uploadName}
        >
          {uploadName}
        </h3>

        {/* Media type and dimensions badges */}
        {!compact && (
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-xs">
              {media.mediaType}
            </Badge>
            {dimensions.width && dimensions.height && (
              <Badge variant="outline" className="text-xs">
                <Maximize2 className="h-3 w-3 mr-1" />
                {formatDimensions(dimensions.width, dimensions.height)}
              </Badge>
            )}
          </div>
        )}

        {/* Codec info */}
        {!compact && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Codec:</span>{' '}
            {getCodec()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
