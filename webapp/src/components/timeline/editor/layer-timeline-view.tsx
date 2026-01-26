'use client';

import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';
import { useTimeline } from '@/hooks/use-timeline';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TimelineClip } from '@project/shared';

const PIXELS_PER_SECOND = 20;
const MIN_CLIP_DURATION = 0.5;

interface DragState {
  clipId: string;
  handle: 'left' | 'right';
  initialX: number;
  currentX: number;
  initialStart: number;
  initialEnd: number;
  mediaDuration: number;
}

export function LayerTimelineView() {
  const {
    timeline,
    currentTime,
    setCurrentTime,
    duration,
    isPlaying,
    selectedClipId,
    setSelectedClipId,
    updateClipTimes,
  } = useTimeline();

  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragInfoRef = useRef<DragState | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);

  // Track container width for centering playhead
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Ensure minimum duration of 60s for the timeline view
  const displayDuration = Math.max(duration, 60);
  const totalWidth = useMemo(
    () => displayDuration * PIXELS_PER_SECOND,
    [displayDuration]
  );

  // Helper to get clip display times (taking drag into account)
  const getClipTimes = useCallback(
    (clip: TimelineClip) => {
      if (dragState && dragState.clipId === clip.id) {
        const deltaPixels = dragState.currentX - dragState.initialX;
        const deltaTime = deltaPixels / PIXELS_PER_SECOND;

        let newStart = clip.start;
        let newEnd = clip.end;

        if (dragState.handle === 'left') {
          // Adjust start: clamp between 0 and (end - min_duration)
          newStart = Math.min(
            Math.max(0, dragState.initialStart + deltaTime),
            dragState.initialEnd - MIN_CLIP_DURATION
          );
        } else {
          // Adjust end: clamp between (start + min_duration) and media_duration
          newEnd = Math.max(
            Math.min(dragState.mediaDuration, dragState.initialEnd + deltaTime),
            dragState.initialStart + MIN_CLIP_DURATION
          );
        }
        return { start: newStart, end: newEnd };
      }
      return { start: clip.start, end: clip.end };
    },
    [dragState]
  );

  // Handle Drag Start for Resizing
  const handleResizeStart = useCallback(
    (
      e: React.MouseEvent | React.TouchEvent,
      clip: TimelineClip,
      handle: 'left' | 'right'
    ) => {
      e.stopPropagation();
      // Prevent default to stop scrolling while dragging handles
      if (e.cancelable) {
        e.preventDefault();
      }
      setIsScrubbing(false);

      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;

      const mediaDuration = clip.expand?.MediaRef?.duration || 1000; // Fallback if unknown
      const state: DragState = {
        clipId: clip.id,
        handle,
        initialX: clientX,
        currentX: clientX,
        initialStart: clip.start,
        initialEnd: clip.end,
        mediaDuration,
      };

      setDragState(state);
      dragInfoRef.current = state;
    },
    [setIsScrubbing, setDragState]
  );

  // Global mouse handlers for resize drag
  useEffect(() => {
    if (!dragState) return;

    const onMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      setDragState((prev) => (prev ? { ...prev, currentX: clientX } : null));
    };

    const onUp = async (e: MouseEvent | TouchEvent) => {
      const info = dragInfoRef.current;

      if (info) {
        const clientX =
          'changedTouches' in e
            ? e.changedTouches[0].clientX
            : (e as MouseEvent).clientX;
        const deltaPixels = clientX - info.initialX;
        const deltaTime = deltaPixels / PIXELS_PER_SECOND;

        let finalStart = info.initialStart;
        let finalEnd = info.initialEnd;

        if (info.handle === 'left') {
          finalStart = Math.min(
            Math.max(0, info.initialStart + deltaTime),
            info.initialEnd - MIN_CLIP_DURATION
          );
        } else {
          finalEnd = Math.max(
            Math.min(info.mediaDuration, info.initialEnd + deltaTime),
            info.initialStart + MIN_CLIP_DURATION
          );
        }

        try {
          if (
            finalStart !== info.initialStart ||
            finalEnd !== info.initialEnd
          ) {
            await updateClipTimes(info.clipId, finalStart, finalEnd);
          }
        } catch (error) {
          console.error('Failed to update clip times', error);
        }
      }

      setDragState(null);
      dragInfoRef.current = null;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [dragState, updateClipTimes]);

  // Determine the clips to display, filtered by the main track (Layer 0)
  const displayClips = useMemo(() => {
    const clips = timeline?.clips;
    if (!clips) return [];

    const tracks = timeline?.tracks;
    const mainTrack = tracks?.find((t) => t.layer === 0) || tracks?.[0];

    // If no tracks are found, fallback to showing all clips (legacy/empty state)
    if (!mainTrack) return clips;

    const mainTrackId = mainTrack.id;
    return clips.filter(
      (c) =>
        !(c as any).TimelineTrackRef ||
        (c as any).TimelineTrackRef === mainTrackId
    );
  }, [timeline?.clips, timeline?.tracks]);

  // Calculate clip positions and elements
  const clipElements = useMemo(() => {
    // Phase 1: Calculate positions in a simple loop.
    // This avoids reassigning a variable that is later captured by JSX during a map,
    // which satisfies the React Compiler's strict mutation rules.
    const positions: { left: number; width: number; clipDuration: number }[] =
      [];
    let acc = 0;
    for (const clip of displayClips) {
      const { start, end } = getClipTimes(clip);
      const duration = end - start;
      positions.push({
        left: acc * PIXELS_PER_SECOND,
        width: duration * PIXELS_PER_SECOND,
        clipDuration: duration,
      });
      acc += duration;
    }

    // Phase 2: Map to elements
    return displayClips.map((clip: TimelineClip, i: number) => {
      const pos = positions[i];
      const isSelected = selectedClipId === clip.id;
      const clipColor =
        clip.meta?.color || (isSelected ? 'bg-primary' : 'bg-blue-600/60');

      return (
        <div
          key={clip.id}
          className={cn(
            'absolute top-0 bottom-0 border-r border-background/20 transition-all group cursor-pointer',
            clipColor,
            isSelected && 'ring-2 ring-inset ring-white/50 z-10 shadow-sm'
          )}
          style={{ left: pos.left, width: pos.width }}
          onClick={(e) => {
            e.stopPropagation();
            setSelectedClipId(clip.id);
          }}
        >
          {isSelected && (
            <>
              {/* Left Handle */}
              <div
                className="absolute left-0 top-0 bottom-0 w-6 -left-3 cursor-ew-resize flex items-center justify-center z-20 group/handle"
                onMouseDown={(e) => handleResizeStart(e, clip, 'left')}
                onTouchStart={(e) => handleResizeStart(e, clip, 'left')}
              >
                <div className="w-1.5 h-8 bg-white shadow-sm rounded-full group-hover/handle:scale-110 transition-transform" />
              </div>

              {/* Right Handle */}
              <div
                className="absolute right-0 top-0 bottom-0 w-6 -right-3 cursor-ew-resize flex items-center justify-center z-20 group/handle"
                onMouseDown={(e) => handleResizeStart(e, clip, 'right')}
                onTouchStart={(e) => handleResizeStart(e, clip, 'right')}
              >
                <div className="w-1.5 h-8 bg-white shadow-sm rounded-full group-hover/handle:scale-110 transition-transform" />
              </div>

              {/* Info Label */}
              <div className="absolute top-1 left-4 text-[10px] text-white font-mono pointer-events-none truncate pr-4 drop-shadow-md">
                {Math.round(pos.clipDuration * 10) / 10}s
              </div>
            </>
          )}
        </div>
      );
    });
  }, [
    displayClips,
    getClipTimes,
    selectedClipId,
    handleResizeStart,
    setSelectedClipId,
  ]);

  const handleTimelineClick = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const x = clientX - rect.left;
      const time = Math.max(
        0,
        Math.min(displayDuration, x / PIXELS_PER_SECOND)
      );
      setCurrentTime(time);
    },
    [displayDuration, setCurrentTime]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      // If we are dragging a handle, don't scrub
      if (dragState) return;

      setIsScrubbing(true);
      handleTimelineClick(e);

      // Deselect if clicking on the empty areas of the track
      // (The clip clicks stopPropagation)
      setSelectedClipId(null);
    },
    [handleTimelineClick, dragState, setSelectedClipId]
  );

  useEffect(() => {
    if (!isScrubbing) return;

    const handleMouseMove = (e: MouseEvent | TouchEvent) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const x = clientX - rect.left;
      const time = Math.max(
        0,
        Math.min(displayDuration, x / PIXELS_PER_SECOND)
      );
      setCurrentTime(time);
    };

    const handleMouseUp = () => {
      setIsScrubbing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleMouseMove, { passive: false });
    window.addEventListener('touchend', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleMouseMove);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, [isScrubbing, displayDuration, setCurrentTime]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Auto-scroll effect to keep playhead in view during playback
  useEffect(() => {
    if (isPlaying && containerRef.current && !isScrubbing) {
      const container = containerRef.current;
      const playheadX = currentTime * PIXELS_PER_SECOND;
      const scrollLeft = container.scrollLeft;
      const scrollRight = scrollLeft + container.clientWidth;

      // Use a small buffer so it doesn't hit the absolute edge
      const buffer = 40;

      if (playheadX > scrollRight - buffer || playheadX < scrollLeft + buffer) {
        container.scrollLeft = playheadX - container.clientWidth / 2;
      }
    }
  }, [currentTime, isPlaying, isScrubbing]);

  // Generate ruler ticks
  const ticks = useMemo(() => {
    const tickCount = Math.ceil(displayDuration) + 1;
    const items = [];
    const interval = PIXELS_PER_SECOND;

    for (let i = 0; i < tickCount; i++) {
      const isMajor = i % 5 === 0;
      items.push(
        <div
          key={i}
          className={cn(
            'absolute bottom-0 border-l border-muted-foreground/30',
            isMajor ? 'h-3' : 'h-1.5'
          )}
          style={{ left: i * interval }}
        >
          {isMajor && (
            <span className="absolute -top-5 left-1 text-[10px] text-muted-foreground whitespace-nowrap">
              {formatTime(i)}
            </span>
          )}
        </div>
      );
    }
    return items;
  }, [displayDuration]);

  if (!timeline) return null;

  return (
    <div className="flex flex-col w-full bg-background border rounded-lg overflow-hidden shadow-inner h-40 relative group/timeline">
      {/* Deselect Button (Visible only when a clip is selected) */}
      {selectedClipId && (
        <Button
          variant="secondary"
          size="icon"
          className="absolute top-2 right-2 z-50 h-8 w-8 rounded-full shadow-lg opacity-0 group-hover/timeline:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedClipId(null);
          }}
          title="Deselect Clip"
        >
          <X className="h-4 w-4" />
        </Button>
      )}

      {/* Scrubber Area */}
      <div
        ref={containerRef}
        className="relative h-full overflow-x-auto overflow-y-hidden bg-grid-white/[0.02] border-t border-b"
      >
        <div
          ref={trackRef}
          className="relative h-full select-none"
          style={{
            width: totalWidth + containerWidth,
            minWidth: '100%',
            cursor: isScrubbing ? 'grabbing' : 'ew-resize',
          }}
          onMouseDown={handleMouseDown}
          onTouchStart={handleMouseDown}
        >
          {/* Ruler */}
          <div className="absolute top-0 left-0 right-0 h-8 border-b bg-muted/30 z-10">
            {ticks}
          </div>

          {/* Tracks (centered vertically in remaining space) */}
          <div className="absolute top-8 left-0 right-0 bottom-0 bg-muted/5 flex items-center px-0">
            <div className="h-16 w-full relative">
              {/* Clickable background layer for deselect?
                     Actually the container mouseDown handles scrubbing.
                  */}
              {clipElements}
            </div>
          </div>

          {/* Playhead */}
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)] z-40 cursor-ew-resize group/playhead"
            style={{ left: currentTime * PIXELS_PER_SECOND }}
            onMouseDown={(e) => {
              e.stopPropagation();
              setIsScrubbing(true);
              handleTimelineClick(e);
            }}
            onTouchStart={(e) => {
              e.stopPropagation();
              setIsScrubbing(true);
              handleTimelineClick(e);
            }}
          >
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-4 bg-red-500 rotate-45 -translate-y-2 rounded-sm shadow-sm group-hover/playhead:scale-110 active:group-hover/playhead:scale-95 transition-transform" />

            {/* Playhead Time Label */}
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-red-600 text-white text-[10px] font-mono px-1.5 py-0.5 rounded opacity-0 group-hover/playhead:opacity-100 transition-opacity whitespace-nowrap pointer-events-none shadow-md">
              {formatTime(currentTime)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
