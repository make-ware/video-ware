'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Type } from 'lucide-react';
import type { TimelineClip, MediaClip, Caption } from '@project/shared';
import { CompositeClipOverlay } from './composite-clip-overlay';

export interface ClipBlockProps {
  clip: TimelineClip;
  left: number;
  width: number;
  isSelected: boolean;
  isLocked: boolean;
  /** True while this clip is mid-move-drag (ghost shows the drop target) */
  isDragging?: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onResizeStart: (
    handle: 'left' | 'right',
    e: React.MouseEvent | React.TouchEvent
  ) => void;
  /** Pointer-down on the clip body — parent decides when it becomes a drag */
  onMoveStart: (e: React.MouseEvent | React.TouchEvent) => void;
  /** Double-click on the clip body (used to open editors) */
  onDoubleClick?: (e: React.MouseEvent) => void;
}

export function ClipBlock({
  clip,
  left,
  width,
  isSelected,
  isLocked,
  isDragging = false,
  onSelect,
  onResizeStart,
  onMoveStart,
  onDoubleClick,
}: ClipBlockProps) {
  const clipDuration = clip.end - clip.start;
  const isCaption = !!clip.CaptionRef;
  const caption = (clip as TimelineClip & { expand?: { CaptionRef?: Caption } })
    .expand?.CaptionRef;
  const clipColor =
    clip.meta?.color ||
    (isCaption
      ? 'bg-purple-600/60'
      : isSelected
        ? 'bg-primary'
        : 'bg-blue-600/60');

  // Extract composite clip data
  const mediaClip = (
    clip as TimelineClip & { expand?: { MediaClipRef?: MediaClip } }
  ).expand?.MediaClipRef;
  const clipData = mediaClip?.clipData as
    | { segments?: Array<{ start: number; end: number }> }
    | undefined;
  const segments = clipData?.segments;
  const isComposite =
    mediaClip?.type === 'composite' && segments && segments.length > 0;

  return (
    <div
      className={cn(
        'absolute top-0 bottom-0 border-r border-background/20 group touch-none',
        clipColor,
        !isLocked && 'cursor-grab active:cursor-grabbing',
        isSelected && 'ring-2 ring-inset ring-white/50 z-10 shadow-sm',
        isLocked && 'cursor-not-allowed opacity-60',
        isDragging && 'opacity-40',
        // Position updates must be instant while dragging/resizing
        !isDragging && 'transition-colors'
      )}
      style={{ left, width }}
      onClick={(e) => {
        e.stopPropagation();
        if (!isLocked) {
          onSelect(e);
        }
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!isLocked) {
          onDoubleClick?.(e);
        }
      }}
      onMouseDown={(e) => {
        if (!isLocked) {
          onMoveStart(e);
        }
      }}
      onTouchStart={(e) => {
        if (!isLocked) {
          onMoveStart(e);
        }
      }}
    >
      {/* Resize Handles - only show when selected and not locked */}
      {isSelected && !isLocked && (
        <>
          {/* Left Handle */}
          <div
            className="absolute top-0 bottom-0 w-8 -left-4 cursor-ew-resize flex items-center justify-center z-20 group/handle touch-none"
            onMouseDown={(e) => onResizeStart('left', e)}
            onTouchStart={(e) => onResizeStart('left', e)}
          >
            <div className="w-1.5 h-8 bg-white shadow-sm rounded-full group-hover/handle:scale-110 transition-transform" />
          </div>

          {/* Right Handle */}
          <div
            className="absolute top-0 bottom-0 w-8 -right-4 cursor-ew-resize flex items-center justify-center z-20 group/handle touch-none"
            onMouseDown={(e) => onResizeStart('right', e)}
            onTouchStart={(e) => onResizeStart('right', e)}
          >
            <div className="w-1.5 h-8 bg-white shadow-sm rounded-full group-hover/handle:scale-110 transition-transform" />
          </div>

          {/* Duration Label */}
          <div className="absolute top-1 left-4 text-[10px] text-white font-mono pointer-events-none truncate pr-4 drop-shadow-md">
            {Math.round(clipDuration * 10) / 10}s
          </div>
        </>
      )}

      {/* Caption clips show an icon + their text */}
      {isCaption && (
        <div className="absolute inset-0 flex items-center gap-1 px-1.5 pointer-events-none overflow-hidden">
          <Type className="h-3 w-3 shrink-0 text-white/80" />
          <span className="text-[10px] text-white truncate drop-shadow-md">
            {clip.meta?.title || caption?.text || 'Caption'}
          </span>
        </div>
      )}

      {/* Composite Clip Overlay - show segment visualization */}
      {isComposite && (
        <CompositeClipOverlay
          segments={segments!}
          clipStart={clip.start}
          clipEnd={clip.end}
          showBadge={true}
        />
      )}
    </div>
  );
}
