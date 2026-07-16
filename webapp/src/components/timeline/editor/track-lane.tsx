'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import {
  analyzeTrackJunctions,
  clusterOverlappingRanges,
  getClipRanges,
  getSortedTrackClips,
  type PlacedClip,
  type TimelineClip,
  type TimelineTrackRecord,
} from '@project/shared';
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
  /** Double-click on a clip body (open the matching editor) */
  onClipDoubleClick?: (clip: TimelineClip) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  /** Live position/size override while a clip on this lane is being resized */
  resizeOverride?: { clipId: string; left: number; width: number } | null;
  /** Clip currently mid-move-drag (rendered dimmed; ghost shows the target) */
  movingClipId?: string | null;
  /** True while a move drag is hovering this lane */
  isDropTarget?: boolean;
  /** True when this lane is the selected insertion target */
  isSelected?: boolean;
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
  onClipDoubleClick,
  onDragOver,
  onDrop,
  resizeOverride,
  movingClipId,
  isDropTarget,
  isSelected,
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

  // Junction indicators: how consecutive clips meet (touching seams vs.
  // nearly-touching micro-gaps) plus any same-track overlap regions. Same
  // classification the timeline doctor reports; hidden while a drag is in
  // flight since the committed positions lag the preview.
  const dragInFlight = !!resizeOverride || !!movingClipId;
  const { junctions, overlapRegions } = React.useMemo(() => {
    const sorted = getSortedTrackClips(clips);
    const ranges = getClipRanges(clips);
    const placed: PlacedClip[] = sorted.map((clip, i) => ({
      clip,
      globalStart: ranges[i].start,
      globalEnd: ranges[i].end,
    }));
    const clusters = clusterOverlappingRanges(placed, (p) => ({
      start: p.globalStart,
      end: p.globalEnd,
    }));
    return {
      junctions: analyzeTrackJunctions(placed),
      overlapRegions: clusters.map((cluster) => ({
        key: cluster.map((p) => p.clip.id).join('-'),
        start: cluster[0].globalStart,
        end: Math.max(...cluster.map((p) => p.globalEnd)),
        count: cluster.length,
      })),
    };
  }, [clips]);

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
        isSelected &&
          !isLocked &&
          'bg-primary/10 hover:bg-primary/10 shadow-[inset_2px_0_0_0_var(--primary)]',
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
          onDoubleClick={() => onClipDoubleClick?.(clip)}
        />
      ))}

      {/* Junction indicators (hidden mid-drag; positions lag the preview) */}
      {!dragInFlight &&
        junctions.map((junction) =>
          junction.kind === 'micro-gap' ? (
            // Amber sliver covering the gap itself — clips are nearly
            // touching, which is usually an unintended drop position.
            <div
              key={`gap-${junction.beforeClipId}-${junction.afterClipId}`}
              className="absolute top-0 bottom-0 z-20 bg-amber-500/70"
              style={{
                left: junction.time * pixelsPerSecond,
                width: Math.max(junction.gap * pixelsPerSecond, 3),
              }}
              title={`${Math.max(1, Math.round(junction.gap * 1000))}ms gap — clips are nearly touching`}
            />
          ) : (
            // Small centered pill at the seam of touching clips: sky when the
            // source media continues seamlessly, emerald for a hard cut.
            <div
              key={`join-${junction.beforeClipId}-${junction.afterClipId}`}
              className={cn(
                'absolute top-1/2 z-20 h-6 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none',
                junction.kind === 'continuous'
                  ? 'bg-sky-400/80'
                  : 'bg-emerald-400/80'
              )}
              style={{ left: junction.time * pixelsPerSecond }}
            />
          )
        )}

      {/* Same-track overlap regions (invalid per the data model) */}
      {!dragInFlight &&
        overlapRegions.map((region) => (
          <div
            key={`overlap-${region.key}`}
            className="absolute top-0 bottom-0 z-20 border-x-2 border-red-500/70 bg-red-500/20 pointer-events-none"
            style={{
              left: region.start * pixelsPerSecond,
              width: Math.max((region.end - region.start) * pixelsPerSecond, 3),
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
