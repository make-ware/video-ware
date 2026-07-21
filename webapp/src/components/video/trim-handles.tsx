'use client';

import { useState, useCallback, useRef, useEffect, useId } from 'react';
import { useViewWindow } from '@/hooks/use-view-window';
import { WindowScrollbar } from '@/components/video/window-scrollbar';
import { cn } from '@/lib/utils';

export interface TrimHandlesProps {
  /** Total duration of the media in seconds */
  duration: number;
  /** Current start time in seconds */
  startTime: number;
  /** Current end time in seconds */
  endTime: number;
  /** Callback when start or end time changes */
  onChange: (start: number, end: number) => void;
  /**
   * Callback to scrub an attached video player whenever the user edits a handle
   * or drags the playhead along the track. Parents should seek their <video>
   * element to `time`.
   */
  onScrub?: (time: number, handle: 'start' | 'end' | 'playhead') => void;
  /** Current playhead position in seconds (optional) */
  currentTime?: number;
  /**
   * Composite clip edit list to display on the track (source-time seconds).
   * Display-only: the handles still trim the whole-clip window; parts of a
   * segment outside the window render dimmed like any other trimmed content.
   */
  segments?: Array<{ start: number; end: number }>;
  /** Minimum clip duration in seconds */
  minDuration?: number;
  /** Whether the component is disabled */
  disabled?: boolean;
  /** Additional class name */
  className?: string;
}

const KEYBOARD_STEP = 0.1; // seconds per arrow key press
const KEYBOARD_STEP_LARGE = 1; // seconds per shift+arrow key press

/** Pixels of travel before a press on the range becomes a move, not a tap. */
const DRAG_THRESHOLD_PX = 3;

export function TrimHandles({
  duration,
  startTime,
  endTime,
  onChange,
  onScrub,
  currentTime,
  segments,
  minDuration = 0.5,
  disabled = false,
  className,
}: TrimHandlesProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const trackId = useId();
  const [dragging, setDragging] = useState<
    'start' | 'end' | 'playhead' | 'move' | null
  >(null);
  // Whole-range move gesture (drag the middle of the selected range). The
  // session snapshots the range at pointer-down so the drag is absolute.
  const moveSessionRef = useRef<{
    originStart: number;
    originEnd: number;
    grabTime: number;
    startClientX: number;
    moved: boolean;
  } | null>(null);
  const [focusedHandle, setFocusedHandle] = useState<'start' | 'end' | null>(
    null
  );
  const scrubRafRef = useRef<number | null>(null);
  const pendingScrubRef = useRef<{
    time: number;
    handle: 'start' | 'end' | 'playhead';
  } | null>(null);
  const lastScrubRef = useRef<{
    time: number;
    handle: 'start' | 'end' | 'playhead';
  } | null>(null);
  const lastScrubAtRef = useRef<number>(0);

  // Zoomable/pannable view window over the media. Defaults to the clip's
  // trim range plus wiggle room; zooming out is gated at the full media
  // length so the handles can always reach 0% / 100% of the media.
  const { view, canZoomIn, canZoomOut, zoomIn, zoomOut, panTo, reveal } =
    useViewWindow({
      total: duration,
      contentStart: startTime,
      contentEnd: endTime,
    });
  const viewSpan = view.to - view.from;

  const scheduleScrub = useCallback(
    (time: number, handle: 'start' | 'end' | 'playhead') => {
      if (!onScrub) return;
      pendingScrubRef.current = { time, handle };

      if (scrubRafRef.current !== null) return;
      scrubRafRef.current = requestAnimationFrame(() => {
        scrubRafRef.current = null;
        const next = pendingScrubRef.current;
        if (!next) return;

        const now =
          typeof performance !== 'undefined' ? performance.now() : Date.now();
        // Throttle seeks to reduce network range requests / jank while dragging.
        if (now - lastScrubAtRef.current < 75) {
          // schedule one more frame to pick up the latest pending value
          if (scrubRafRef.current === null) {
            scrubRafRef.current = requestAnimationFrame(() => {
              scrubRafRef.current = null;
              const pending = pendingScrubRef.current;
              if (!pending) return;
              lastScrubAtRef.current =
                typeof performance !== 'undefined'
                  ? performance.now()
                  : Date.now();
              onScrub(pending.time, pending.handle);
            });
          }
          return;
        }

        const last = lastScrubRef.current;
        if (
          last &&
          last.handle === next.handle &&
          Math.abs(last.time - next.time) < 0.05
        ) {
          return;
        }

        lastScrubRef.current = next;
        lastScrubAtRef.current = now;
        onScrub(next.time, next.handle);
      });
    },
    [onScrub]
  );

  useEffect(() => {
    return () => {
      if (scrubRafRef.current !== null) {
        cancelAnimationFrame(scrubRafRef.current);
      }
    };
  }, []);

  // Convert time to percentage position within the view window
  const timeToPercent = useCallback(
    (time: number) => {
      if (viewSpan <= 0) return 0;
      return Math.max(0, Math.min(100, ((time - view.from) / viewSpan) * 100));
    },
    [view.from, viewSpan]
  );

  // Convert percentage position within the view window to time
  const percentToTime = useCallback(
    (percent: number) => {
      const time = view.from + (percent / 100) * viewSpan;
      return Math.max(0, Math.min(duration, time));
    },
    [view.from, viewSpan, duration]
  );

  // Keep externally-changed handles visible (numeric inputs, I/O keys,
  // fine-tune apply): pan minimally to reveal the handle that moved out of
  // the window. Never fires mid-drag — dragging is clamped to the window.
  const prevTimesRef = useRef({ start: startTime, end: endTime });
  useEffect(() => {
    const prev = prevTimesRef.current;
    prevTimesRef.current = { start: startTime, end: endTime };
    if (dragging) return;
    if (startTime !== prev.start) reveal(startTime);
    if (endTime !== prev.end) reveal(endTime);
  }, [startTime, endTime, dragging, reveal]);

  // Get mouse/touch position as percentage
  const getPositionPercent = useCallback((clientX: number) => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    return Math.max(0, Math.min(100, (x / rect.width) * 100));
  }, []);

  // Handle drag start
  const handleDragStart = useCallback(
    (handle: 'start' | 'end') => (e: React.MouseEvent | React.TouchEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      setDragging(handle);
      scheduleScrub(handle === 'start' ? startTime : endTime, handle);
    },
    [disabled, scheduleScrub, startTime, endTime]
  );

  // Press on the selected range: crossing the drag threshold shifts the
  // whole range (duration preserved); releasing without crossing it is a
  // tap and scrubs the playhead there, like pressing anywhere else on the
  // track.
  const handleMoveStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      moveSessionRef.current = {
        originStart: startTime,
        originEnd: endTime,
        grabTime: percentToTime(getPositionPercent(clientX)),
        startClientX: clientX,
        moved: false,
      };
      setDragging('move');
    },
    [disabled, startTime, endTime, percentToTime, getPositionPercent]
  );

  // Click / drag anywhere on the track to move the playhead (scrub the video).
  // Handle grab areas stop propagation, so this only fires off the handles.
  const handleTrackPointerDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (disabled || !onScrub) return;
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const time = percentToTime(getPositionPercent(clientX));
      scheduleScrub(time, 'playhead');
      setDragging('playhead');
    },
    [disabled, onScrub, percentToTime, getPositionPercent, scheduleScrub]
  );

  // Handle drag move
  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const percent = getPositionPercent(clientX);
      const time = percentToTime(percent);

      if (dragging === 'playhead') {
        // Free scrub of the playhead across the whole media; trim range
        // is unaffected.
        scheduleScrub(time, 'playhead');
      } else if (dragging === 'move') {
        const session = moveSessionRef.current;
        if (!session) return;
        if (
          !session.moved &&
          Math.abs(clientX - session.startClientX) < DRAG_THRESHOLD_PX
        ) {
          return;
        }
        session.moved = true;
        // Shift by pointer travel from the grab point, clamped to the
        // media bounds (not the window — the range may extend past it).
        const span = session.originEnd - session.originStart;
        const newStart = Math.max(
          0,
          Math.min(duration - span, session.originStart + time - session.grabTime)
        );
        onChange(newStart, newStart + span);
        scheduleScrub(newStart, 'start');
      } else if (dragging === 'start') {
        // Ensure start doesn't exceed end - minDuration
        const maxStart = endTime - minDuration;
        const newStart = Math.max(0, Math.min(maxStart, time));
        onChange(newStart, endTime);
        scheduleScrub(newStart, 'start');
      } else {
        // Ensure end doesn't go below start + minDuration
        const minEnd = startTime + minDuration;
        const newEnd = Math.max(minEnd, Math.min(duration, time));
        onChange(startTime, newEnd);
        scheduleScrub(newEnd, 'end');
      }
    };

    const handleUp = () => {
      const session = moveSessionRef.current;
      if (dragging === 'move' && session && !session.moved) {
        // A tap on the selected range: scrub the playhead there.
        scheduleScrub(session.grabTime, 'playhead');
      }
      moveSessionRef.current = null;
      setDragging(null);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    document.addEventListener('touchmove', handleMove);
    document.addEventListener('touchend', handleUp);

    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleUp);
    };
  }, [
    dragging,
    startTime,
    endTime,
    duration,
    minDuration,
    onChange,
    getPositionPercent,
    percentToTime,
    scheduleScrub,
  ]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (handle: 'start' | 'end') => (e: React.KeyboardEvent) => {
      if (disabled) return;

      const step = e.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP;
      let newStart = startTime;
      let newEnd = endTime;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          if (handle === 'start') {
            newStart = Math.max(0, startTime - step);
          } else {
            newEnd = Math.max(startTime + minDuration, endTime - step);
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (handle === 'start') {
            newStart = Math.min(endTime - minDuration, startTime + step);
          } else {
            newEnd = Math.min(duration, endTime + step);
          }
          break;
        case 'Home':
          e.preventDefault();
          if (handle === 'start') {
            newStart = 0;
          }
          break;
        case 'End':
          e.preventDefault();
          if (handle === 'end') {
            newEnd = duration;
          }
          break;
        default:
          return;
      }

      onChange(newStart, newEnd);
      scheduleScrub(handle === 'start' ? newStart : newEnd, handle);
    },
    [
      disabled,
      startTime,
      endTime,
      duration,
      minDuration,
      onChange,
      scheduleScrub,
    ]
  );

  const startPercent = timeToPercent(startTime);
  const endPercent = timeToPercent(endTime);
  const currentPercent =
    currentTime !== undefined &&
    currentTime >= view.from &&
    currentTime <= view.to
      ? timeToPercent(currentTime)
      : null;

  // Handles scrolled/zoomed out of the window pin to its edge, dimmed.
  const isStartOffWindow =
    startTime < view.from - 0.01 || startTime > view.to + 0.01;
  const isEndOffWindow = endTime < view.from - 0.01 || endTime > view.to + 0.01;

  const formatTime = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${min}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  // Check if handles are at boundaries
  const isStartAtBoundary = startTime <= 0.01;
  const isEndAtBoundary = endTime >= duration - 0.01;

  return (
    <div className={cn('relative w-full', className)}>
      {/* Container with padding for extended grab areas */}
      <div className="relative px-8 sm:px-6">
        {/* View window bounds */}
        <div className="flex justify-between mb-1 text-[10px] font-mono text-muted-foreground">
          <span>{formatTime(view.from)}</span>
          <span>{formatTime(view.to)}</span>
        </div>

        {/* Track background */}
        <div
          ref={trackRef}
          id={trackId}
          className={cn(
            'relative h-12 sm:h-10 bg-muted rounded-md overflow-visible touch-none',
            !disabled && onScrub && 'cursor-pointer',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
          onMouseDown={handleTrackPointerDown}
          onTouchStart={handleTrackPointerDown}
        >
          {/* Segment blocks (composite clips) — rendered under the inactive
              shading so content outside the trim window reads as dropped */}
          {segments?.map((seg, i) =>
            seg.end < view.from || seg.start > view.to ? null : (
              <div
                key={i}
                className="absolute top-1.5 bottom-1.5 rounded-sm bg-primary/40 border border-primary/60 pointer-events-none"
                style={{
                  left: `${timeToPercent(seg.start)}%`,
                  width: `${Math.max(timeToPercent(seg.end) - timeToPercent(seg.start), 0.5)}%`,
                }}
              />
            )
          )}

          {/* Inactive region (before start) */}
          <div
            className="absolute top-0 bottom-0 left-0 bg-black/40"
            style={{ width: `${startPercent}%` }}
          />

          {/* Active region (selected range) — drag to shift the whole range */}
          <div
            className={cn(
              'absolute top-0 bottom-0 bg-primary/20 border-y-2 border-primary touch-none',
              !disabled && 'cursor-grab',
              dragging === 'move' && 'cursor-grabbing bg-primary/30'
            )}
            style={{
              left: `${startPercent}%`,
              width: `${endPercent - startPercent}%`,
            }}
            onMouseDown={handleMoveStart}
            onTouchStart={handleMoveStart}
          />

          {/* Inactive region (after end) */}
          <div
            className="absolute top-0 bottom-0 right-0 bg-black/40"
            style={{ width: `${100 - endPercent}%` }}
          />

          {/* Current time indicator (playhead) */}
          {currentPercent !== null && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_3px_rgba(0,0,0,0.8)] z-[25] pointer-events-none"
              style={{ left: `${currentPercent}%` }}
            >
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-sm" />
            </div>
          )}

          {/* Extended grab area for start handle (invisible, extends beyond timeline) */}
          <div
            className={cn(
              'absolute top-0 bottom-0 cursor-ew-resize z-30 touch-none',
              disabled && 'cursor-not-allowed'
            )}
            style={{
              left: `calc(${startPercent}% - 24px)`,
              width: '48px',
            }}
            onMouseDown={handleDragStart('start')}
            onTouchStart={handleDragStart('start')}
          />

          {/* Start handle */}
          <div
            role="slider"
            aria-label="Trim start"
            aria-valuemin={0}
            aria-valuemax={endTime - minDuration}
            aria-valuenow={startTime}
            aria-valuetext={formatTime(startTime)}
            tabIndex={disabled ? -1 : 0}
            className={cn(
              'absolute top-0 bottom-0 w-3 sm:w-2.5 cursor-ew-resize z-20',
              'bg-primary hover:bg-primary/80 active:bg-primary/90 transition-all',
              'flex items-center justify-center',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              'touch-none shadow-lg',
              dragging === 'start' && 'bg-primary scale-105 shadow-xl',
              focusedHandle === 'start' && 'ring-2 ring-ring ring-offset-2',
              isStartAtBoundary && 'ring-2 ring-yellow-400/60',
              isStartOffWindow && 'opacity-50'
            )}
            style={{
              left: `calc(${startPercent}% - 6px)`,
            }}
            onMouseDown={handleDragStart('start')}
            onTouchStart={handleDragStart('start')}
            onKeyDown={handleKeyDown('start')}
            onFocus={() => setFocusedHandle('start')}
            onBlur={() => setFocusedHandle(null)}
          >
            {/* Visible handle indicator - larger and more prominent */}
            <div className="w-1 h-full sm:h-5 bg-white/90 rounded-full shadow-sm" />
            {/* Additional visual indicator at boundary */}
            {isStartAtBoundary && (
              <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-1 h-1 bg-yellow-400 rounded-full" />
            )}
          </div>

          {/* Extended grab area for end handle (invisible, extends beyond timeline) */}
          <div
            className={cn(
              'absolute top-0 bottom-0 cursor-ew-resize z-30 touch-none',
              disabled && 'cursor-not-allowed'
            )}
            style={{
              left: `calc(${endPercent}% - 24px)`,
              width: '48px',
            }}
            onMouseDown={handleDragStart('end')}
            onTouchStart={handleDragStart('end')}
          />

          {/* End handle */}
          <div
            role="slider"
            aria-label="Trim end"
            aria-valuemin={startTime + minDuration}
            aria-valuemax={duration}
            aria-valuenow={endTime}
            aria-valuetext={formatTime(endTime)}
            tabIndex={disabled ? -1 : 0}
            className={cn(
              'absolute top-0 bottom-0 w-3 sm:w-2.5 cursor-ew-resize z-20',
              'bg-primary hover:bg-primary/80 active:bg-primary/90 transition-all',
              'flex items-center justify-center',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              'touch-none shadow-lg',
              dragging === 'end' && 'bg-primary scale-105 shadow-xl',
              focusedHandle === 'end' && 'ring-2 ring-ring ring-offset-2',
              isEndAtBoundary && 'ring-2 ring-yellow-400/60',
              isEndOffWindow && 'opacity-50'
            )}
            style={{
              left: `calc(${endPercent}% - 6px)`,
            }}
            onMouseDown={handleDragStart('end')}
            onTouchStart={handleDragStart('end')}
            onKeyDown={handleKeyDown('end')}
            onFocus={() => setFocusedHandle('end')}
            onBlur={() => setFocusedHandle(null)}
          >
            {/* Visible handle indicator - larger and more prominent */}
            <div className="w-1 h-full sm:h-5 bg-white/90 rounded-full shadow-sm" />
            {/* Additional visual indicator at boundary */}
            {isEndAtBoundary && (
              <div className="absolute -right-1 top-1/2 -translate-y-1/2 w-1 h-1 bg-yellow-400 rounded-full" />
            )}
          </div>
        </div>

        {/* Window zoom + drag-scroll controls */}
        {duration > 0 && (
          <WindowScrollbar
            className="mt-2"
            controlsId={trackId}
            total={duration}
            view={view}
            onPan={panTo}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            canZoomIn={canZoomIn}
            canZoomOut={canZoomOut}
            disabled={disabled}
          />
        )}
      </div>

      {/* Time labels */}
      <div className="flex justify-between mt-1 sm:mt-2 text-xs text-muted-foreground gap-2">
        <span className="font-mono truncate">{formatTime(startTime)}</span>
        <span className="font-mono text-foreground text-center shrink-0 hidden sm:inline">
          Duration: {formatTime(endTime - startTime)}
        </span>
        <span className="font-mono text-foreground text-center shrink-0 sm:hidden">
          {formatTime(endTime - startTime)}
        </span>
        <span className="font-mono truncate text-right">
          {formatTime(endTime)}
        </span>
      </div>
    </div>
  );
}
