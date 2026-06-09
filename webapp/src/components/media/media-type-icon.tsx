import { Film, Music, Image as ImageIcon } from 'lucide-react';
import { MediaType } from '@project/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** PocketBase select fields are typed as `T | T[]`; collapse to a single value. */
export type MediaTypeValue = MediaType | MediaType[] | string | undefined;

function normalizeMediaType(mediaType: MediaTypeValue): string | undefined {
  return Array.isArray(mediaType) ? mediaType[0] : mediaType;
}

interface MediaTypeIconProps {
  mediaType?: MediaTypeValue;
  className?: string;
}

/**
 * Renders the lucide icon representing a media type.
 * Falls back to the video (Film) icon for unknown types.
 */
export function MediaTypeIcon({ mediaType, className }: MediaTypeIconProps) {
  switch (normalizeMediaType(mediaType)) {
    case MediaType.AUDIO:
      return <Music className={className} />;
    case MediaType.IMAGE:
      return <ImageIcon className={className} />;
    case MediaType.VIDEO:
    default:
      return <Film className={className} />;
  }
}

/** Human-readable label for a media type. */
export function getMediaTypeLabel(mediaType?: MediaTypeValue): string {
  switch (normalizeMediaType(mediaType)) {
    case MediaType.AUDIO:
      return 'Audio';
    case MediaType.IMAGE:
      return 'Image';
    case MediaType.VIDEO:
      return 'Video';
    default:
      return 'Media';
  }
}

interface MediaTypeBadgeProps {
  mediaType?: MediaTypeValue;
  /** When true, only the icon is shown (no label). */
  iconOnly?: boolean;
  className?: string;
}

/** Small pill showing a media type's icon + label, used on media cards. */
export function MediaTypeBadge({
  mediaType,
  iconOnly = false,
  className,
}: MediaTypeBadgeProps) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'bg-black/70 text-white gap-1 backdrop-blur-sm',
        iconOnly && 'px-1.5',
        className
      )}
    >
      <MediaTypeIcon mediaType={mediaType} className="h-3 w-3" />
      {!iconOnly && getMediaTypeLabel(mediaType)}
    </Badge>
  );
}
