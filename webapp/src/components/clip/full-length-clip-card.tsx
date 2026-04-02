'use client';

import { Badge } from '@/components/ui/badge';
import { MediaBaseCard } from '@/components/media/media-base-card';
import { cn } from '@/lib/utils';
import type { Media } from '@project/shared';

interface FullLengthClipCardProps {
  media: Media;
  duration: number;
  isActive: boolean;
  onSelect: () => void;
  className?: string;
}

export function FullLengthClipCard({
  media,
  duration,
  isActive,
  onSelect,
  className,
}: FullLengthClipCardProps) {
  const formatTime = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <MediaBaseCard
      media={media}
      startTime={0}
      endTime={duration}
      onSelect={onSelect}
      className={cn(
        isActive && 'border-primary shadow-md bg-primary/5',
        className
      )}
      title={
        <div className="flex items-center justify-between gap-1.5 min-w-0">
          <Badge
            variant="outline"
            className={cn(
              'uppercase text-[10px] font-semibold h-5 px-2',
              isActive && 'border-primary/50 bg-primary/10'
            )}
          >
            FULL
          </Badge>
        </div>
      }
      subtitle={
        <div className="mt-1 flex flex-col gap-1">
          <div
            className={cn(
              'text-[10px] font-medium truncate opacity-80',
              isActive && 'text-primary'
            )}
          >
            Full Video
          </div>
          <div className="flex gap-2 text-[10px] text-muted-foreground font-mono">
            <span className="flex items-center justify-between gap-1">
              <span className="opacity-70">In:</span>
              {formatTime(0)}
            </span>
            <span className="flex items-center justify-between gap-1">
              <span className="opacity-70">Out:</span>
              {formatTime(duration)}
            </span>
          </div>
        </div>
      }
    />
  );
}
