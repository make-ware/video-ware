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
import { X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TimelineClip } from '@project/shared';
import { TrackLane } from './track-lane';
import { TrackHeader } from './track-header';
import { SnapGuide } from './snap-guide';
import { useSnap } from './use-snap';

const PIXELS_PER_SECOND = 20;
const MIN_CLIP_DURATION = 0.5;
const TRACK_HEADER_WIDTH = 200; // pixels

interface DragState {
  clipId: string;
  sourceTrackId: string;
  handle: 'left' | 'right' | 'move';
  initialX: number;
  currentX: number;
  initialStart: number;
  initialEnd: number;
  initialTimelineStart?: number;
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
    selectedTrackId,
    setSelectedTrackId,
    updateClipTimes,
    createTrack,
    updateTrack,
    deleteTrack,
    moveClipToTrack,
    updateClipPosition,
  } = useTimeline();

  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragInfoRef = useRef<DragState | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const trackAreaRef = useRef<HTMLDivElement>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const [shiftPressed, setShiftPressed] = useState(false);

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

  // Listen for Shift key to disable snapping
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setShiftPressed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setShiftPressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Ensure minimum duration of 60s for the timeline view
  const displayDuration = Math.max(duration, 60);
  const totalWidth = useMemo(
    () => displayDuration * PIXELS_PER_SECOND,
    [displayDuration]
  );

  // Sort tracks by layer (descending - highest layer on top)
  const sortedTracks = useMemo(() => {
    if (!timeline?.tracks) return [];
    return [...timeline.tracks].sort((a, b) => b.layer - a.layer);
  }, [timeline?.tracks]);

  // Group clips by track
  const clipsByTrack = useMemo(() => {
    if (!timeline?.clips) return new Map();

    const map = new Map<string, TimelineClip[]>();

    for (const clip of timeline.clips) {
      const trackId = clip.TimelineTrackRef || '';
      if (!map.has(trackId)) {
        map.set(trackId, []);
      }
      map.get(trackId)!.push(clip);
    }

    return map;
  }, [timeline?.clips]);

  // Initialize snap engine
  const { snapTime, activeGuides, clearGuides } = useSnap({
    clips: timeline?.clips || [],
    currentTime,
    pixelsPerSecond: PIXELS_PER_SECOND,
    threshold: 8,
    enabled: !shiftPressed,
  });

  // Helper to get clip display times (taking drag into account)
  const _getClipTimes = useCallback(
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
        } else if (dragState.handle === 'right') {
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
  const _handleResizeStart = useCallback(
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
      const trackId = clip.TimelineTrackRef || '';

      const state: DragState = {
        clipId: clip.id,
        sourceTrackId: trackId,
        handle,
        initialX: clientX,
        currentX: clientX,
        initialStart: clip.start,
        initialEnd: clip.end,
        initialTimelineStart: clip.timelineStart,
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
          const candidateStart = Math.min(
            Math.max(0, info.initialStart + deltaTime),
            info.initialEnd - MIN_CLIP_DURATION
          );

          // Apply snapping
          const { snapped } = snapTime(candidateStart, info.clipId);
          finalStart = snapped;
        } else if (info.handle === 'right') {
          const candidateEnd = Math.max(
            Math.min(info.mediaDuration, info.initialEnd + deltaTime),
            info.initialStart + MIN_CLIP_DURATION
          );

          // Apply snapping
          const { snapped } = snapTime(candidateEnd, info.clipId);
          finalEnd = snapped;
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
      clearGuides();
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
  }, [dragState, updateClipTimes, snapTime, clearGuides]);

  // Track management handlers
  const handleCreateTrack = useCallback(async () => {
    try {
      await createTrack();
    } catch (error) {
      console.error('Failed to create track', error);
    }
  }, [createTrack]);

  const handleTrackRename = useCallback(
    async (trackId: string, name: string) => {
      try {
        await updateTrack(trackId, { name });
      } catch (error) {
        console.error('Failed to rename track', error);
      }
    },
    [updateTrack]
  );

  const handleTrackToggleMute = useCallback(
    async (trackId: string, currentMuted: boolean) => {
      try {
        await updateTrack(trackId, { isMuted: !currentMuted });
      } catch (error) {
        console.error('Failed to toggle mute', error);
      }
    },
    [updateTrack]
  );

  const handleTrackToggleLock = useCallback(
    async (trackId: string, currentLocked: boolean) => {
      try {
        await updateTrack(trackId, { isLocked: !currentLocked });
      } catch (error) {
        console.error('Failed to toggle lock', error);
      }
    },
    [updateTrack]
  );

  const handleTrackVolumeChange = useCallback(
    async (trackId: string, volume: number) => {
      try {
        await updateTrack(trackId, { volume });
      } catch (error) {
        console.error('Failed to update volume', error);
      }
    },
    [updateTrack]
  );

  const handleTrackOpacityChange = useCallback(
    async (trackId: string, opacity: number) => {
      try {
        await updateTrack(trackId, { opacity });
      } catch (error) {
        console.error('Failed to update opacity', error);
      }
    },
    [updateTrack]
  );

  const handleTrackDelete = useCallback(
    async (trackId: string) => {
      const confirmed = window.confirm(
        'Are you sure you want to delete this track? All clips on this track will also be deleted.'
      );
      if (confirmed) {
        try {
          await deleteTrack(trackId, true);
        } catch (error) {
          console.error('Failed to delete track', error);
        }
      }
    },
    [deleteTrack]
  );

  // Clip drag and drop handlers
  const [draggedClipId, setDraggedClipId] = useState<string | null>(null);
  const [_dragTargetTrackId, setDragTargetTrackId] = useState<string | null>(
    null
  );

  const handleClipDragStart = useCallback(
    (clipId: string, e: React.DragEvent) => {
      setDraggedClipId(clipId);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', clipId);
    },
    []
  );

  const handleTrackDragOver = useCallback(
    (trackId: string, e: React.DragEvent) => {
      e.preventDefault();
      setDragTargetTrackId(trackId);
    },
    []
  );

  const handleTrackDrop = useCallback(
    async (trackId: string, e: React.DragEvent) => {
      e.preventDefault();

      if (!draggedClipId || !trackAreaRef.current) {
        return;
      }

      const track = sortedTracks.find((t) => t.id === trackId);
      if (!track || track.isLocked) {
        setDraggedClipId(null);
        setDragTargetTrackId(null);
        return;
      }

      // Calculate drop position on timeline
      const rect = trackAreaRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left - TRACK_HEADER_WIDTH;
      const candidateTime = Math.max(0, x / PIXELS_PER_SECOND);

      // Apply snapping
      const { snapped: timelineStart } = snapTime(candidateTime, draggedClipId);

      try {
        const clip = timeline?.clips.find((c) => c.id === draggedClipId);
        const sourceTrackId = clip?.TimelineTrackRef;

        if (sourceTrackId === trackId) {
          // Same track - just update position
          await updateClipPosition(draggedClipId, timelineStart);
        } else {
          // Different track - move clip
          await moveClipToTrack(draggedClipId, trackId, timelineStart);
        }
      } catch (error) {
        console.error('Failed to move clip', error);
      } finally {
        setDraggedClipId(null);
        setDragTargetTrackId(null);
        clearGuides();
      }
    },
    [
      draggedClipId,
      sortedTracks,
      timeline?.clips,
      snapTime,
      updateClipPosition,
      moveClipToTrack,
      clearGuides,
    ]
  );

  const handleTimelineClick = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!trackAreaRef.current) return;
      const rect = trackAreaRef.current.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const x = clientX - rect.left - TRACK_HEADER_WIDTH;
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
      if (!trackAreaRef.current) return;
      const rect = trackAreaRef.current.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const x = clientX - rect.left - TRACK_HEADER_WIDTH;
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

  // Show empty state if no tracks exist
  const hasNoTracks = sortedTracks.length === 0;

  return (
    <div className="flex flex-col w-full bg-background border rounded-lg overflow-hidden shadow-inner relative group/timeline">
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

      {/* Timeline Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Track Headers Sidebar */}
        <div
          className="flex-shrink-0 border-r bg-muted/20"
          style={{ width: TRACK_HEADER_WIDTH }}
        >
          {/* Ruler Header Spacer */}
          <div className="h-8 border-b bg-muted/30 flex items-center justify-center">
            <span className="text-xs text-muted-foreground font-medium">
              Tracks
            </span>
          </div>

          {/* Track Headers */}
          <div
            className="overflow-y-auto"
            style={{ maxHeight: 'calc(100% - 2rem)' }}
          >
            {hasNoTracks ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No tracks yet. Create one to get started.
              </div>
            ) : (
              sortedTracks.map((track) => (
                <TrackHeader
                  key={track.id}
                  track={track}
                  isSelected={selectedTrackId === track.id}
                  onSelect={() => setSelectedTrackId(track.id)}
                  onRename={(name) => handleTrackRename(track.id, name)}
                  onToggleMute={() =>
                    handleTrackToggleMute(track.id, track.isMuted)
                  }
                  onToggleLock={() =>
                    handleTrackToggleLock(track.id, track.isLocked)
                  }
                  onVolumeChange={(volume) =>
                    handleTrackVolumeChange(track.id, volume)
                  }
                  onOpacityChange={(opacity) =>
                    handleTrackOpacityChange(track.id, opacity)
                  }
                  onDelete={() => handleTrackDelete(track.id)}
                />
              ))
            )}

            {/* Add Track Button */}
            <div className="p-2 border-t">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleCreateTrack}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Track
              </Button>
            </div>
          </div>
        </div>

        {/* Timeline Scrubber Area */}
        <div
          ref={containerRef}
          className="relative flex-1 overflow-x-auto overflow-y-auto bg-grid-white/[0.02]"
        >
          <div
            ref={trackAreaRef}
            className="relative select-none"
            style={{
              width: totalWidth + containerWidth,
              minWidth: '100%',
              cursor: isScrubbing ? 'grabbing' : 'ew-resize',
            }}
            onMouseDown={handleMouseDown}
            onTouchStart={handleMouseDown}
          >
            {/* Ruler */}
            <div className="sticky top-0 left-0 right-0 h-8 border-b bg-muted/30 z-20">
              {ticks}
            </div>

            {/* Track Lanes */}
            <div className="relative">
              {hasNoTracks ? (
                <div className="h-16 flex items-center justify-center text-sm text-muted-foreground bg-muted/5 border-b">
                  Create a track to start adding clips
                </div>
              ) : (
                sortedTracks.map((track) => {
                  const trackClips = clipsByTrack.get(track.id) || [];
                  return (
                    <TrackLane
                      key={track.id}
                      track={track}
                      clips={trackClips}
                      totalWidth={totalWidth}
                      pixelsPerSecond={PIXELS_PER_SECOND}
                      isLocked={track.isLocked}
                      selectedClipId={selectedClipId}
                      onClipSelect={setSelectedClipId}
                      onClipDragStart={handleClipDragStart}
                      onDragOver={(e) => handleTrackDragOver(track.id, e)}
                      onDrop={(e) => handleTrackDrop(track.id, e)}
                      onClipResize={(_clipId, _handle, _deltaTime) => {
                        // This is handled by the resize handlers above
                      }}
                      snapGuides={activeGuides}
                    />
                  );
                })
              )}
            </div>

            {/* Snap Guides */}
            {activeGuides.map((guide, index) => (
              <SnapGuide
                key={`${guide.source}-${guide.time}-${index}`}
                position={guide.time * PIXELS_PER_SECOND}
                orientation="vertical"
                label={formatTime(guide.time)}
              />
            ))}

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
              <div className="absolute top-8 left-1/2 -translate-x-1/2 w-4 h-4 bg-red-500 rotate-45 -translate-y-2 rounded-sm shadow-sm group-hover/playhead:scale-110 active:group-hover/playhead:scale-95 transition-transform" />

              {/* Playhead Time Label */}
              <div className="absolute top-1 left-1/2 -translate-x-1/2 bg-red-600 text-white text-[10px] font-mono px-1.5 py-0.5 rounded opacity-0 group-hover/playhead:opacity-100 transition-opacity whitespace-nowrap pointer-events-none shadow-md">
                {formatTime(currentTime)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
