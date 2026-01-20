'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
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
   * Callback to scrub an attached video player whenever the user edits a handle.
   * Parents should seek their <video> element to `time`.
   */
  onScrub?: (time: number, handle: 'start' | 'end') => void;
  /** Current playhead position in seconds (optional) */
  currentTime?: number;
  /** Minimum clip duration in seconds */
  minDuration?: number;
  /** Whether the component is disabled */
  disabled?: boolean;
  /** Additional class name */
  className?: string;
}

const KEYBOARD_STEP = 0.1; // seconds per arrow key press
const KEYBOARD_STEP_LARGE = 1; // seconds per shift+arrow key press

export function TrimHandles({
  duration,
  startTime,
  endTime,
  onChange,
  onScrub,
  currentTime,
  minDuration = 0.5,
  disabled = false,
  className,
}: TrimHandlesProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);
  const [focusedHandle, setFocusedHandle] = useState<'start' | 'end' | null>(
    null
  );
  const scrubRafRef = useRef<number | null>(null);
  const pendingScrubRef = useRef<{
    time: number;
    handle: 'start' | 'end';
  } | null>(null);
  const lastScrubRef = useRef<{ time: number; handle: 'start' | 'end' } | null>(
    null
  );
  const lastScrubAtRef = useRef<number>(0);

  const scheduleScrub = useCallback(
    (time: number, handle: 'start' | 'end') => {
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

  // Convert time to percentage position
  const timeToPercent = useCallback(
    (time: number) => {
      if (duration <= 0) return 0;
      return Math.max(0, Math.min(100, (time / duration) * 100));
    },
    [duration]
  );

  // Convert percentage position to time
  const percentToTime = useCallback(
    (percent: number) => {
      return Math.max(0, Math.min(duration, (percent / 100) * duration));
    },
    [duration]
  );

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

  // Handle drag move
  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const percent = getPositionPercent(clientX);
      const time = percentToTime(percent);

      if (dragging === 'start') {
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
    currentTime !== undefined ? timeToPercent(currentTime) : null;

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
        {/* Track background */}
        <div
          ref={trackRef}
          className={cn(
            'relative h-12 sm:h-10 bg-muted rounded-md overflow-visible touch-none',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
        >
          {/* Inactive region (before start) */}
          <div
            className="absolute top-0 bottom-0 left-0 bg-black/40"
            style={{ width: `${startPercent}%` }}
          />

          {/* Active region (selected range) */}
          <div
            className="absolute top-0 bottom-0 bg-primary/20 border-y-2 border-primary"
            style={{
              left: `${startPercent}%`,
              width: `${endPercent - startPercent}%`,
            }}
          />

          {/* Inactive region (after end) */}
          <div
            className="absolute top-0 bottom-0 right-0 bg-black/40"
            style={{ width: `${100 - endPercent}%` }}
          />

          {/* Current time indicator */}
          {currentPercent !== null && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-white z-10 pointer-events-none"
              style={{ left: `${currentPercent}%` }}
            />
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
              isStartAtBoundary && 'ring-2 ring-yellow-400/60'
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
              isEndAtBoundary && 'ring-2 ring-yellow-400/60'
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
