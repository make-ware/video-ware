'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Layers } from 'lucide-react';
import { windowCompositeSegments } from '@project/shared';

export interface CompositeSegment {
  start: number;
  end: number;
}

interface CompositeClipOverlayProps {
  /**
   * The composite clip's full edit list (in source media time)
   */
  segments: CompositeSegment[];
  /**
   * The clip's trim window start (source time) — windows the edit list
   */
  clipStart: number;
  /**
   * The clip's trim window end (source time)
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
 * Overlay that visualizes a composite clip's cut points on its timeline
 * block. The block's width is the clip's effective (gap-skipping) duration,
 * so each boundary between consecutive windowed segments sits at its
 * cumulative effective offset — gaps take no width, they ARE the cuts.
 */
export function CompositeClipOverlay({
  segments,
  clipStart,
  clipEnd,
  className,
  showBadge = true,
}: CompositeClipOverlayProps) {
  if (segments.length === 0) {
    return null;
  }

  // The portion of the edit list inside the clip's trim window is what
  // plays; the window is what the resize handles adjust.
  const windowed = windowCompositeSegments(
    [...segments].sort((a, b) => a.start - b.start),
    clipStart,
    clipEnd
  );
  const totalDuration = windowed.reduce(
    (sum, seg) => sum + Math.max(0, seg.end - seg.start),
    0
  );

  if (totalDuration <= 0) {
    return null;
  }

  // Cut points: the boundary after each windowed segment except the last,
  // as a percentage of the effective length.
  const boundaries: number[] = [];
  let elapsed = 0;
  for (const seg of windowed.slice(0, -1)) {
    elapsed += Math.max(0, seg.end - seg.start);
    boundaries.push((elapsed / totalDuration) * 100);
  }

  return (
    <div
      className={cn(
        'absolute inset-0 pointer-events-none z-5 overflow-hidden',
        className
      )}
    >
      {/* Cut points between segments */}
      {boundaries.map((percent, i) => (
        <div
          key={`cut-${i}`}
          className="absolute top-0 bottom-0 w-[2px] -translate-x-1/2 bg-white/40"
          style={{ left: `${percent}%` }}
        />
      ))}

      {/* Badge showing segment count */}
      {showBadge && (
        <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] px-1.5 py-0.5 rounded flex items-center gap-1">
          <Layers className="w-2.5 h-2.5" />
          <span>{windowed.length}</span>
        </div>
      )}
    </div>
  );
}
