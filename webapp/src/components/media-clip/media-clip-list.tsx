import type { Media, MediaClip } from '@project/shared';
import { cn } from '@/lib/utils';
import { MediaClipItem } from './media-clip-item';

interface MediaClipListProps {
  media: Media;
  clips: MediaClip[];
  onClipSelect: (clip: MediaClip) => void;
  activeClipId?: string;
  className?: string;
}

export function MediaClipList({
  media,
  clips,
  onClipSelect,
  activeClipId,
  className,
}: MediaClipListProps) {
  if (clips.length === 0) {
    return (
      <div className={cn('text-center py-8 text-muted-foreground', className)}>
        No clips found for this media.
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {clips.map((clip) => (
        <MediaClipItem
          key={clip.id}
          clip={clip}
          media={media}
          isActive={activeClipId === clip.id}
          onClick={() => onClipSelect(clip)}
        />
      ))}
    </div>
  );
}
