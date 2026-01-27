'use client';

import React, { useMemo } from 'react';
import { calculateEffectiveDuration } from '@project/shared';
import type { Media, CompositeSegment, File } from '@project/shared';
import { SpriteAnimator } from '@/components/sprite/sprite-animator';
import { cn } from '@/lib/utils';
import { Clock } from 'lucide-react';

interface MediaWithExpand extends Media {
  expand?: {
    spriteFileRef?: File;
  };
}

interface CompositeClipPreviewProps {
  media: MediaWithExpand;
  segments: CompositeSegment[];
  isHovering: boolean;
  className?: string;
}

export function CompositeClipPreview({
  media,
  segments,
  isHovering,
  className,
}: CompositeClipPreviewProps) {
  // Sort segments by start time
  const sortedSegments = useMemo(
    () => [...segments].sort((a, b) => a.start - b.start),
    [segments]
  );

  const effectiveDuration = useMemo(
    () => calculateEffectiveDuration(0, media.duration, segments),
    [media.duration, segments]
  );

  return (
    <div
      className={cn(
        'relative w-full h-full flex bg-muted overflow-hidden',
        className
      )}
    >
      {sortedSegments.length > 0 ? (
        sortedSegments.map((seg, index) => {
          const segDuration = seg.end - seg.start;
          const widthPercent = (segDuration / effectiveDuration) * 100;

          if (widthPercent <= 0) return null;

          return (
            <div
              key={`${index}-${seg.start}`}
              className="relative h-full overflow-hidden border-r border-background/20 last:border-r-0"
              style={{ width: `${widthPercent}%` }}
            >
              <SpriteAnimator
                media={media}
                spriteFile={media.expand?.spriteFileRef}
                start={seg.start}
                end={seg.end}
                isHovering={isHovering}
                className="w-full h-full object-cover"
                fallbackIcon={
                  index === 0 ? (
                    <div className="text-center text-xs text-muted-foreground absolute inset-0 flex flex-col items-center justify-center">
                      <Clock className="h-4 w-4 mb-1" />
                    </div>
                  ) : undefined
                }
              />
            </div>
          );
        })
      ) : (
        <div className="flex items-center justify-center h-full w-full">
          <div className="text-center text-xs text-muted-foreground">
            <Clock className="h-6 w-6 mx-auto mb-1" />
            <div>Empty Composite</div>
          </div>
        </div>
      )}
    </div>
  );
}
