'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Layers } from 'lucide-react';

export interface CompositeSegment {
  start: number;
  end: number;
}

interface CompositeClipOverlayProps {
  /**
   * The composite segments (in source media time)
   */
  segments: CompositeSegment[];
  /**
   * The overall clip start time (min of all segments)
   */
  clipStart: number;
  /**
   * The overall clip end time (max of all segments)
   */
  clipEnd: number;
  /**
   * Optional className for the container
   */
  className?: string;
  /**
   * Show the segment count badge
   */
  showBadge?: boolean;
}

/**
 * Overlay component that visualizes segment boundaries within a composite clip.
 *
 * Renders highlighted regions for active segments and dimmed/striped regions for gaps.
 */
export function CompositeClipOverlay({
  segments,
  clipStart,
  clipEnd,
  className,
  showBadge = true,
}: CompositeClipOverlayProps) {
  const totalRange = clipEnd - clipStart;

  if (totalRange <= 0 || segments.length === 0) {
    return null;
  }

  // Sort segments by start time
  const sortedSegments = [...segments].sort((a, b) => a.start - b.start);

  // Calculate positions as percentages
  const getPositionPercent = (time: number) =>
    ((time - clipStart) / totalRange) * 100;

  // Build gap regions (areas between segments)
  const gaps: { startPercent: number; widthPercent: number }[] = [];
  for (let i = 0; i < sortedSegments.length - 1; i++) {
    const currentEnd = sortedSegments[i].end;
    const nextStart = sortedSegments[i + 1].start;
    if (nextStart > currentEnd) {
      gaps.push({
        startPercent: getPositionPercent(currentEnd),
        widthPercent:
          getPositionPercent(nextStart) - getPositionPercent(currentEnd),
      });
    }
  }

  // Also check for gap at start (if first segment doesn't start at clipStart)
  if (sortedSegments[0].start > clipStart) {
    gaps.unshift({
      startPercent: 0,
      widthPercent: getPositionPercent(sortedSegments[0].start),
    });
  }

  // And gap at end
  const lastSegment = sortedSegments[sortedSegments.length - 1];
  if (lastSegment.end < clipEnd) {
    gaps.push({
      startPercent: getPositionPercent(lastSegment.end),
      widthPercent: 100 - getPositionPercent(lastSegment.end),
    });
  }

  return (
    <div
      className={cn(
        'absolute inset-0 pointer-events-none z-5 overflow-hidden',
        className
      )}
    >
      {/* Gap regions (striped/dimmed) */}
      {gaps.map((gap, i) => (
        <div
          key={`gap-${i}`}
          className="absolute top-0 bottom-0 bg-black/40"
          style={{
            left: `${gap.startPercent}%`,
            width: `${gap.widthPercent}%`,
            backgroundImage:
              'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(0,0,0,0.3) 3px, rgba(0,0,0,0.3) 6px)',
          }}
        />
      ))}

      {/* Segment boundaries (subtle vertical lines) */}
      {sortedSegments.map((seg, i) => (
        <React.Fragment key={`seg-${i}`}>
          {/* Start boundary */}
          <div
            className="absolute top-0 bottom-0 w-[1px] bg-white/30"
            style={{ left: `${getPositionPercent(seg.start)}%` }}
          />
          {/* End boundary */}
          <div
            className="absolute top-0 bottom-0 w-[1px] bg-white/30"
            style={{ left: `${getPositionPercent(seg.end)}%` }}
          />
        </React.Fragment>
      ))}

      {/* Badge showing segment count */}
      {showBadge && (
        <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] px-1.5 py-0.5 rounded flex items-center gap-1">
          <Layers className="w-2.5 h-2.5" />
          <span>{segments.length}</span>
        </div>
      )}
    </div>
  );
}
