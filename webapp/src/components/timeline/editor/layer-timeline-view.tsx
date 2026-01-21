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

const PIXELS_PER_SECOND = 40;
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
    selectedClipId,
    setSelectedClipId,
    updateClipTimes,
  } = useTimeline();

  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragInfoRef = useRef<DragState | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);

  // Ensure minimum duration of 60s for the timeline view
  const displayDuration = Math.max(duration, 60);
  const totalWidth = useMemo(
    () => displayDuration * PIXELS_PER_SECOND,
    [displayDuration]
  );

  // Helper to get clip display times (taking drag into account)
  const getClipTimes = useCallback(
    (clip: any) => {
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
  const handleResizeStart = (
    e: React.MouseEvent,
    clip: any,
    handle: 'left' | 'right'
  ) => {
    e.stopPropagation();
    e.preventDefault();
    setIsScrubbing(false);

    const mediaDuration = clip.expand?.MediaRef?.duration || 1000; // Fallback if unknown
    const state: DragState = {
      clipId: clip.id,
      handle,
      initialX: e.clientX,
      currentX: e.clientX,
      initialStart: clip.start,
      initialEnd: clip.end,
      mediaDuration,
    };

    setDragState(state);
    dragInfoRef.current = state;
  };

  // Global mouse handlers for resize drag
  useEffect(() => {
    if (!dragState) return;

    const onMove = (e: MouseEvent) => {
      e.preventDefault();
      setDragState((prev) => (prev ? { ...prev, currentX: e.clientX } : null));
    };

    const onUp = async (e: MouseEvent) => {
      e.preventDefault();
      const info = dragInfoRef.current;

      if (info) {
        const deltaPixels = e.clientX - info.initialX;
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
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragState !== null, updateClipTimes]); // Depend on existence of drag state

  // Calculate clip positions and elements
  const clipElements = useMemo(() => {
    if (!timeline) return [];

    // We need to iterate to calculate positions sequentially
    let accTime = 0;

    return timeline.clips.map((clip: any) => {
      // Get potentially modified times
      const { start, end } = getClipTimes(clip);
      const clipDuration = end - start;

      const left = accTime * PIXELS_PER_SECOND;
      const width = clipDuration * PIXELS_PER_SECOND;

      const isSelected = selectedClipId === clip.id;
      const clipColor =
        clip.meta?.color ||
        (isSelected ? 'bg-primary' : 'bg-blue-600/60');

      // Update accumulator for next clip
      accTime += clipDuration;

      return (
        <div
          key={clip.id}
          className={cn(
            'absolute top-0 bottom-0 border-r border-background/20 transition-all group cursor-pointer',
            clipColor,
            isSelected && 'ring-2 ring-inset ring-white/50 z-10 shadow-sm'
          )}
          style={{ left, width }}
          onClick={(e) => {
            // Allow bubbling to container for scrubbing?
            // If we stopPropagation, clicking clip selects but doesn't move playhead.
            // Let's stopPropagation to make it distinct.
            e.stopPropagation();
            setSelectedClipId(clip.id);
          }}
        >
          {isSelected && (
            <>
              {/* Left Handle */}
              <div
                className="absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize flex items-center justify-center hover:bg-white/20 z-20"
                onMouseDown={(e) => handleResizeStart(e, clip, 'left')}
              >
                <div className="w-1 h-4 bg-white/50 rounded-full" />
              </div>

              {/* Right Handle */}
              <div
                className="absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize flex items-center justify-center hover:bg-white/20 z-20"
                onMouseDown={(e) => handleResizeStart(e, clip, 'right')}
              >
                <div className="w-1 h-4 bg-white/50 rounded-full" />
              </div>

              {/* Info Label */}
              <div className="absolute top-1 left-4 text-[10px] text-white font-mono pointer-events-none truncate pr-4 drop-shadow-md">
                {Math.round(clipDuration * 10) / 10}s
              </div>
            </>
          )}
        </div>
      );
    });
  }, [timeline, selectedClipId, getClipTimes, setSelectedClipId]); // Re-render when drag updates via getClipTimes

  const handleTimelineClick = useCallback(
    (e: React.MouseEvent) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const time = Math.max(
        0,
        Math.min(displayDuration, x / PIXELS_PER_SECOND)
      );
      setCurrentTime(time);
    },
    [displayDuration, setCurrentTime]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // If we are dragging a handle, don't scrub
      if (dragState) return;

      setIsScrubbing(true);
      handleTimelineClick(e);
    },
    [handleTimelineClick, dragState]
  );

  useEffect(() => {
    if (!isScrubbing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
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

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isScrubbing, displayDuration, setCurrentTime]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

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
    <div className="flex flex-col w-full bg-background border rounded-lg overflow-hidden shadow-inner h-40">
      {/* Scrubber Area */}
      <div
        ref={containerRef}
        className="relative h-full overflow-x-auto overflow-y-hidden no-scrollbar bg-grid-white/[0.02]"
        style={{ scrollbarWidth: 'none' }}
      >
        <div
          ref={trackRef}
          className="relative h-full select-none cursor-ew-resize"
          style={{ width: Math.max(totalWidth + 100, 200), minWidth: '100%' }}
          onMouseDown={handleMouseDown}
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
            className="absolute top-0 bottom-0 w-[2px] bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)] z-20 pointer-events-none"
            style={{ left: currentTime * PIXELS_PER_SECOND }}
          >
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-4 bg-red-500 rotate-45 -translate-y-2 rounded-sm" />
          </div>
        </div>
      </div>
    </div>
  );
}
