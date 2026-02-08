'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { TimelineClip, TimelineTrackRecord } from '@project/shared';
import { ClipBlock } from './clip-block';
import { calculateClipPosition } from './clip-position';
import type { SnapPosition } from './use-snap';

export interface TrackLaneProps {
  track: TimelineTrackRecord;
  clips: TimelineClip[];
  totalWidth: number;
  pixelsPerSecond: number;
  isLocked: boolean;
  selectedClipId: string | null;
  onClipSelect: (clipId: string) => void;
  onClipDragStart: (clipId: string, e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onClipResize: (
    clipId: string,
    handle: 'left' | 'right',
    deltaTime: number
  ) => void;
  snapGuides: SnapPosition[];
}

export function TrackLane({
  track,
  clips,
  totalWidth,
  pixelsPerSecond,
  isLocked,
  selectedClipId,
  onClipSelect,
  onClipDragStart,
  onDragOver,
  onDrop,
  onClipResize: _onClipResize,
  snapGuides: _snapGuides,
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
        !isLocked && 'hover:bg-muted/10'
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
          isSelected={selectedClipId === clip.id}
          isLocked={isLocked}
          onSelect={() => onClipSelect(clip.id)}
          onResizeStart={(handle, e) => {
            // Calculate delta time from mouse movement
            // This will be handled by the parent component
            // For now, we just pass the event up
            e.stopPropagation();
          }}
          onDragStart={(e) => {
            onClipDragStart(clip.id, e);
          }}
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
