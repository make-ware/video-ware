'use client';

import React from 'react';
import type { CropRect } from '@project/shared';
import { cn } from '@/lib/utils';

/**
 * Crop window over a video/poster frame: the rect area stays clear while a
 * dim mask covers everything outside (one oversized box-shadow, clipped by
 * the overflow-hidden parent), with a border and rule-of-thirds grid inside.
 *
 * Purely presentational — position it inside an element that matches the
 * media's CONTENT box (not an object-contain letterbox frame) with
 * `relative overflow-hidden`. Pointer handling is the caller's: pass
 * `interactive` plus handlers to make the window draggable.
 */
export interface CropRectOverlayProps {
  rect: CropRect;
  /** Cursor/touch affordances for a draggable window. */
  interactive?: boolean;
  label?: string;
  className?: string;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onWheel?: (e: React.WheelEvent<HTMLDivElement>) => void;
}

const pct = (n: number): string => `${n * 100}%`;

export function CropRectOverlay({
  rect,
  interactive,
  label,
  className,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
}: CropRectOverlayProps) {
  return (
    <div
      data-testid="crop-rect-overlay"
      className={cn(
        'absolute border border-white/90 shadow-[0_0_0_100vmax_rgba(0,0,0,0.6)]',
        interactive && 'cursor-move touch-none',
        className
      )}
      style={{
        left: pct(rect.left),
        top: pct(rect.top),
        width: pct(rect.width),
        height: pct(rect.height),
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
    >
      {/* Rule-of-thirds grid */}
      <div className="absolute inset-y-0 left-1/3 w-px bg-white/30" />
      <div className="absolute inset-y-0 left-2/3 w-px bg-white/30" />
      <div className="absolute inset-x-0 top-1/3 h-px bg-white/30" />
      <div className="absolute inset-x-0 top-2/3 h-px bg-white/30" />
      {label && (
        <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-mono text-white/90">
          {label}
        </span>
      )}
    </div>
  );
}
