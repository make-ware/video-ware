import type { Media, MediaRelations, Expanded, File } from '@project/shared';
import { useSpriteData } from './use-sprite-data';
import { useSpriteAnimation } from './use-sprite-animation';
import { SpritePreview } from './sprite-preview';
import { PlayCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SpriteAnimatorProps<
  E extends keyof MediaRelations = 'spriteFileRef',
> {
  media: Media | Expanded<Media, MediaRelations, E>;
  spriteFile?: File;
  start?: number;
  end?: number;
  isHovering: boolean;
  className?: string;
  fallbackIcon?: React.ReactNode;
}

export function SpriteAnimator({
  media,
  spriteFile,
  start,
  end,
  isHovering,
  className,
  fallbackIcon = <PlayCircle className="h-8 w-8" strokeWidth={1.5} />,
}: SpriteAnimatorProps) {
  const { url, config, isLoading } = useSpriteData(media, spriteFile);
  const { frameIndex } = useSpriteAnimation({
    start,
    end,
    fps: config.fps,
    cols: config.cols,
    rows: config.rows,
    isHovering,
    totalDuration: media.duration,
  });

  if (isLoading) {
    return (
      <div
        className={cn(
          'flex items-center justify-center h-full bg-muted/50 animate-pulse',
          className
        )}
      >
        {fallbackIcon}
      </div>
    );
  }

  if (!url) {
    return (
      <div
        className={cn(
          'flex items-center justify-center h-full text-muted-foreground/40',
          className
        )}
      >
        {fallbackIcon}
      </div>
    );
  }

  return (
    <div className={cn('relative w-full h-full overflow-hidden', className)}>
      <SpritePreview url={url} config={config} frameIndex={frameIndex} />
    </div>
  );
}
