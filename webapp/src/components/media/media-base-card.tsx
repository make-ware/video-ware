'use client';

import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { SpriteAnimator } from '@/components/sprite/sprite-animator';
import { Media, File } from '@project/shared';
import { Film } from 'lucide-react';

export interface MediaBaseCardProps {
  media?: Media;
  startTime?: number;
  endTime?: number;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  badges?: React.ReactNode[];
  leftBadges?: React.ReactNode[];
  overlayActions?: React.ReactNode[];
  footerActions?: React.ReactNode[];
  onSelect?: () => void;
  className?: string;
  thumbnailHeight?: string;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  spriteFile?: File;
}

export function MediaBaseCard({
  media,
  startTime,
  endTime,
  title,
  subtitle,
  badges,
  leftBadges,
  overlayActions,
  footerActions,
  onSelect,
  className,
  thumbnailHeight = 'h-24',
  draggable,
  onDragStart,
  spriteFile,
}: MediaBaseCardProps) {
  const [isHovering, setIsHovering] = useState(false);

  return (
    <Card
      draggable={draggable}
      onDragStart={onDragStart}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onClick={onSelect}
      className={cn(
        'group relative overflow-hidden flex flex-col transition-all hover:shadow-md',
        onSelect && 'cursor-pointer active:scale-[0.98]',
        className
      )}
    >
      {/* Preview Area */}
      <div
        className={cn(
          'relative w-full overflow-hidden shrink-0 bg-muted',
          thumbnailHeight
        )}
      >
        {media ? (
          <SpriteAnimator
            media={media}
            spriteFile={spriteFile}
            start={startTime || 0}
            end={endTime || 0}
            isHovering={isHovering}
            className="absolute inset-0"
            fallbackIcon={
              <div className="flex items-center justify-center h-full text-muted-foreground/40">
                <Film className="h-6 w-6" />
              </div>
            }
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground/40">
            <Film className="h-6 w-6" />
          </div>
        )}

        {/* Badges Overlays (Top corners) */}
        {(badges || leftBadges) &&
          ((badges?.length ?? 0) > 0 || (leftBadges?.length ?? 0) > 0) && (
            <div className="absolute top-2 inset-x-2 flex justify-between items-start z-10 pointer-events-none">
              <div className="flex flex-col gap-1 items-start pointer-events-auto">
                {leftBadges}
              </div>
              <div className="flex flex-col gap-1 items-end pointer-events-auto">
                {/* Typically score or duration */}
                {badges}
              </div>
            </div>
          )}

        {/* Action button overlays (Top-right, visible on hover) */}
        {overlayActions && overlayActions.length > 0 && (
          <div className="absolute inset-0 flex items-start justify-end p-1.5 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity bg-black/5 z-20">
            <div className="flex flex-col gap-1.5">{overlayActions}</div>
          </div>
        )}
      </div>

      <CardContent className="p-2 flex flex-col flex-1 gap-1.5 min-h-0">
        {/* Title and Subtitle */}
        <div className="flex flex-col gap-0.5 min-w-0">
          {title && (
            <div className="text-xs font-semibold truncate leading-tight">
              {title}
            </div>
          )}
          {subtitle && (
            <div className="text-[10px] text-muted-foreground truncate font-medium">
              {subtitle}
            </div>
          )}
        </div>

        {/* Footer Actions (Row of buttons) */}
        {footerActions && footerActions.length > 0 && (
          <div className="flex gap-2 pt-1.5 border-t border-border/50 mt-auto">
            {footerActions}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
