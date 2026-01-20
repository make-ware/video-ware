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

export function LayerTimelineView() {
  const { timeline, currentTime, setCurrentTime, duration, selectedClipId } =
    useTimeline();

  // Calculate clip positions and elements
  const clipElements = useMemo(() => {
    if (!timeline) return [];
    let accTime = 0;
    return timeline.clips.map((clip: any) => {
      const clipDuration = clip.end - clip.start;
      const left = accTime * PIXELS_PER_SECOND;
      const width = clipDuration * PIXELS_PER_SECOND;
      const clipColor =
        clip.meta?.color ||
        (selectedClipId === clip.id ? 'bg-primary' : 'bg-blue-600/60');

      const element = (
        <div
          key={clip.id}
          className={cn(
            'absolute top-0 bottom-0 border-r border-background/20 transition-all',
            clipColor,
            selectedClipId === clip.id &&
              'ring-1 ring-inset ring-white/50 z-10 shadow-sm'
          )}
          style={{ left, width }}
        />
      );
      accTime += clipDuration;
      return element;
    });
  }, [timeline, selectedClipId]);

  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);

  const totalWidth = useMemo(() => duration * PIXELS_PER_SECOND, [duration]);

  const handleTimelineClick = useCallback(
    (e: React.MouseEvent) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const time = Math.max(0, Math.min(duration, x / PIXELS_PER_SECOND));
      setCurrentTime(time);
    },
    [duration, setCurrentTime]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsScrubbing(true);
      handleTimelineClick(e);
    },
    [handleTimelineClick]
  );

  useEffect(() => {
    if (!isScrubbing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const time = Math.max(0, Math.min(duration, x / PIXELS_PER_SECOND));
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
  }, [isScrubbing, duration, setCurrentTime]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Generate ruler ticks
  const ticks = useMemo(() => {
    const tickCount = Math.ceil(duration) + 1;
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
  }, [duration]);

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
            <div className="h-16 w-full relative">{clipElements}</div>
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
