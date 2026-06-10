'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { TimelineClip, TimelineTrackRecord } from '@project/shared';
import { ClipBlock } from './clip-block';
import { calculateClipPosition } from './clip-position';

export interface TrackLaneProps {
  track: TimelineTrackRecord;
  clips: TimelineClip[];
  totalWidth: number;
  pixelsPerSecond: number;
  isLocked: boolean;
  selectedClipIds: Set<string>;
  onClipSelect: (clipId: string, e: React.MouseEvent) => void;
  /** Pointer-down on a clip body — starts a move drag (mouse + touch) */
  onClipMoveStart: (
    clip: TimelineClip,
    left: number,
    e: React.MouseEvent | React.TouchEvent
  ) => void;
  /** Pointer-down on a clip resize handle */
  onClipResizeStart: (
    clip: TimelineClip,
    left: number,
    handle: 'left' | 'right',
    e: React.MouseEvent | React.TouchEvent
  ) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  /** Live position/size override while a clip on this lane is being resized */
  resizeOverride?: { clipId: string; left: number; width: number } | null;
  /** Clip currently mid-move-drag (rendered dimmed; ghost shows the target) */
  movingClipId?: string | null;
  /** True while a move drag is hovering this lane */
  isDropTarget?: boolean;
}

export function TrackLane({
  track,
  clips,
  totalWidth,
  pixelsPerSecond,
  isLocked,
  selectedClipIds,
  onClipSelect,
  onClipMoveStart,
  onClipResizeStart,
  onDragOver,
  onDrop,
  resizeOverride,
  movingClipId,
  isDropTarget,
}: TrackLaneProps) {
  // Sort clips by their position (either timelineStart or sequential order)
  const sortedClips = [...clips].sort((a, b) => {
    const aStart = a.timelineStart ?? 0;
    const bStart = b.timelineStart ?? 0;
    return aStart - bStart;
  });

  // Calculate positions for all clips
  const clipPositions = sortedClips.map((clip, index) => {
    // Get all clips that come before this one for sequential positioning
    const precedingClips = sortedClips.slice(0, index);
    const position = calculateClipPosition(
      clip,
      precedingClips,
      pixelsPerSecond
    );

    // Apply the live resize preview while a handle drag is in flight
    if (resizeOverride && resizeOverride.clipId === clip.id) {
      return {
        clip,
        left: resizeOverride.left,
        width: resizeOverride.width,
      };
    }

    return {
      clip,
      ...position,
    };
  });

  const handleDragOver = (e: React.DragEvent) => {
    if (isLocked) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    onDragOver(e);
  };

  const handleDrop = (e: React.DragEvent) => {
    if (isLocked) {
      return;
    }

    e.preventDefault();
    onDrop(e);
  };

  return (
    <div
      className={cn(
        'relative h-16 w-full bg-muted/5 border-b transition-colors',
        isLocked && 'bg-muted/20 cursor-not-allowed',
        !isLocked && 'hover:bg-muted/10',
        isDropTarget && !isLocked && 'bg-primary/5'
      )}
      style={{ width: totalWidth }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      data-track-id={track.id}
      data-track-layer={track.layer}
    >
      {/* Render all clips */}
      {clipPositions.map(({ clip, left, width }) => (
        <ClipBlock
          key={clip.id}
          clip={clip}
          left={left}
          width={width}
          isSelected={selectedClipIds.has(clip.id)}
          isLocked={isLocked}
          isDragging={movingClipId === clip.id}
          onSelect={(e) => onClipSelect(clip.id, e)}
          onMoveStart={(e) => onClipMoveStart(clip, left, e)}
          onResizeStart={(handle, e) =>
            onClipResizeStart(clip, left, handle, e)
          }
        />
      ))}

      {/* Locked indicator overlay */}
      {isLocked && (
        <div className="absolute inset-0 bg-muted/10 pointer-events-none flex items-center justify-center">
          <div className="text-xs text-muted-foreground font-medium bg-background/80 px-2 py-1 rounded">
            Locked
          </div>
        </div>
      )}
    </div>
  );
}
