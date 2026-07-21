'use client';

import React, { useCallback, useRef } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ViewWindow } from '@/hooks/use-view-window';
import { cn } from '@/lib/utils';

export interface WindowScrollbarProps {
  /** id of the track/strip element this scrollbar pans (aria-controls). */
  controlsId: string;
  /** Total addressable time (media duration) the bar represents. */
  total: number;
  /** Current view window within `[0, total]`. */
  view: ViewWindow;
  /** Pan to an absolute window start (span preserved by the caller). */
  onPan: (from: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
  disabled?: boolean;
  className?: string;
}

/** Smallest thumb width (%) that stays comfortably grabbable on touch. */
const MIN_THUMB_PERCENT = 8;

/**
 * Zoom buttons plus a drag-only horizontal scrollbar for a media view
 * window. Scrolling is deliberately restricted to dragging the thumb — no
 * wheel, swipe, or track-click — so it never fights the trim-handle
 * gestures on the track above it.
 */
export function WindowScrollbar({
  controlsId,
  total,
  view,
  onPan,
  onZoomIn,
  onZoomOut,
  canZoomIn,
  canZoomOut,
  disabled = false,
  className,
}: WindowScrollbarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startFrom: number;
  } | null>(null);

  const span = view.to - view.from;
  const rawWidth = total > 0 ? (span / total) * 100 : 100;
  const widthPercent = Math.min(100, Math.max(rawWidth, MIN_THUMB_PERCENT));
  const leftPercent =
    total > 0 ? Math.min((view.from / total) * 100, 100 - widthPercent) : 0;
  const pannable = !disabled && total > 0 && span < total;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!pannable) return;
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startFrom: view.from,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // pointer capture is best-effort (unsupported in some environments)
      }
    },
    [pannable, view.from]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const rect = barRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const deltaTime = ((e.clientX - drag.startClientX) / rect.width) * total;
      onPan(drag.startFrom + deltaTime);
    },
    [total, onPan]
  );

  const handlePointerEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // no-op: capture may never have been granted
      }
    },
    []
  );

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-6 w-6 shrink-0"
        disabled={disabled || !canZoomOut}
        onClick={onZoomOut}
        title="Zoom out"
        aria-label="Zoom out"
      >
        <Minus className="h-3.5 w-3.5" />
      </Button>

      <div
        ref={barRef}
        className="relative h-3 flex-1 rounded-full bg-muted"
        role="scrollbar"
        aria-controls={controlsId}
        aria-orientation="horizontal"
        aria-label="View window position"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, total - span)}
        aria-valuenow={view.from}
      >
        <div
          className={cn(
            'absolute top-0 bottom-0 rounded-full touch-none transition-colors',
            pannable
              ? 'bg-muted-foreground/40 hover:bg-muted-foreground/60 cursor-grab active:cursor-grabbing'
              : 'bg-muted-foreground/20'
          )}
          style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        />
      </div>

      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-6 w-6 shrink-0"
        disabled={disabled || !canZoomIn}
        onClick={onZoomIn}
        title="Zoom in"
        aria-label="Zoom in"
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
