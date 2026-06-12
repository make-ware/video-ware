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
import { X, Plus, Trash2, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MAX_TIMELINE_TRACKS } from '@project/shared';
import type { Caption, TimelineClip } from '@project/shared';
import { TrackLane } from './track-lane';
import { TrackHeader } from './track-header';
import { SnapGuide } from './snap-guide';
import { useSnap } from './use-snap';
import { findNonOverlappingTimelineStart } from './clip-placement';
import { CaptionEditorModal } from '@/components/captions';

const PIXELS_PER_SECOND = 20;
const MIN_CLIP_DURATION = 0.5;
const TRACK_HEADER_WIDTH = 200; // pixels
const TRACK_HEADER_WIDTH_COLLAPSED = 48; // pixels
const RULER_HEIGHT = 32; // h-8
const TRACK_HEIGHT = 64; // h-16
const DRAG_ACTIVATION_PX = 4; // pointer travel before a press becomes a drag

interface DragState {
  clipId: string;
  sourceTrackId: string;
  handle: 'left' | 'right' | 'move';
  /** Move drags only activate after the pointer travels DRAG_ACTIVATION_PX */
  active: boolean;
  initialX: number;
  initialY: number;
  currentX: number;
  initialStart: number;
  initialEnd: number;
  initialTimelineStart?: number;
  /** Timeline-relative pixel position of the clip at drag start */
  initialLeft: number;
  mediaDuration: number;
  /** Live drag preview, updated as the pointer moves (already snapped) */
  targetTrackId: string;
  previewLeft: number;
  previewWidth: number;
  previewTimelineStart: number;
  previewStart: number;
  previewEnd: number;
}

export function LayerTimelineView() {
  const {
    timeline,
    currentTime,
    setCurrentTime,
    duration,
    isPlaying,
    selectedClipIds,
    selectAllClips,
    clearClipSelection,
    handleClipSelect,
    removeSelectedClips,
    selectedTrackId,
    setSelectedTrackId,
    updateClipTimes,
    createTrack,
    updateTrack,
    deleteTrack,
    moveClipToTrack,
    updateClipPosition,
    addClip,
    refreshTimeline,
  } = useTimeline();

  const [dragState, setDragState] = useState<DragState | null>(null);
  const [editingCaption, setEditingCaption] = useState<Caption | null>(null);
  const dragInfoRef = useRef<DragState | null>(null);
  const [trackDeleteDialogOpen, setTrackDeleteDialogOpen] = useState(false);
  const [trackToDelete, setTrackToDelete] = useState<string | null>(null);
  const [isDeletingTrack, setIsDeletingTrack] = useState(false);
  const [clipDeleteDialogOpen, setClipDeleteDialogOpen] = useState(false);
  const [isDeletingClips, setIsDeletingClips] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const trackAreaRef = useRef<HTMLDivElement>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const [shiftPressed, setShiftPressed] = useState(false);
  const [headersCollapsed, setHeadersCollapsed] = useState(false);

  // Start with compact track headers on small screens
  useEffect(() => {
    if (window.matchMedia('(max-width: 1023px)').matches) {
      setHeadersCollapsed(true);
    }
  }, []);

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

  // Initialize snap engine
  const { snapTime, activeGuides, clearGuides } = useSnap({
    clips: timeline?.clips || [],
    currentTime,
    pixelsPerSecond: PIXELS_PER_SECOND,
    threshold: 8,
    enabled: !shiftPressed,
  });

  // Listen for Shift key to disable snapping + multi-select keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setShiftPressed(true);
      }

      // Skip shortcuts when typing in input/textarea
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      // Cmd/Ctrl+A: select all clips
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        selectAllClips();
      }

      // Escape: clear selection (and any stale snap guides)
      if (e.key === 'Escape') {
        clearClipSelection();
        setSelectedTrackId(null);
        clearGuides();
      }

      // Delete/Backspace: open delete confirmation
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        selectedClipIds.size > 0
      ) {
        e.preventDefault();
        setClipDeleteDialogOpen(true);
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
  }, [
    selectAllClips,
    clearClipSelection,
    setSelectedTrackId,
    clearGuides,
    selectedClipIds.size,
  ]);

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

  // Build the shared initial drag state for both resize and move drags
  const buildDragState = useCallback(
    (
      clip: TimelineClip,
      left: number,
      handle: DragState['handle'],
      e: React.MouseEvent | React.TouchEvent
    ): DragState => {
      const point = 'touches' in e ? e.touches[0] : e;
      // Caption clips trim against the caption's own duration
      const mediaDuration = clip.CaptionRef
        ? clip.expand?.CaptionRef?.duration || clip.end
        : clip.expand?.MediaRef?.duration || 1000; // Fallback if unknown
      const trackId = clip.TimelineTrackRef || '';

      return {
        clipId: clip.id,
        sourceTrackId: trackId,
        handle,
        // Resize drags engage immediately; move drags wait for pointer travel
        // so plain clicks still select the clip.
        active: handle !== 'move',
        initialX: point.clientX,
        initialY: point.clientY,
        currentX: point.clientX,
        initialStart: clip.start,
        initialEnd: clip.end,
        initialTimelineStart: clip.timelineStart,
        initialLeft: left,
        mediaDuration,
        targetTrackId: trackId,
        previewLeft: left,
        previewWidth: (clip.end - clip.start) * PIXELS_PER_SECOND,
        previewTimelineStart: left / PIXELS_PER_SECOND,
        previewStart: clip.start,
        previewEnd: clip.end,
      };
    },
    []
  );

  const handleResizeStart = useCallback(
    (
      clip: TimelineClip,
      left: number,
      handle: 'left' | 'right',
      e: React.MouseEvent | React.TouchEvent
    ) => {
      e.stopPropagation();
      // Prevent default to stop scrolling while dragging handles
      if (e.cancelable) {
        e.preventDefault();
      }
      setIsScrubbing(false);

      const state = buildDragState(clip, left, handle, e);
      setDragState(state);
      dragInfoRef.current = state;
    },
    [buildDragState]
  );

  const handleMoveStart = useCallback(
    (
      clip: TimelineClip,
      left: number,
      e: React.MouseEvent | React.TouchEvent
    ) => {
      // Stop the track-area scrub handler; don't preventDefault so a plain
      // click still fires the clip's onClick selection.
      e.stopPropagation();

      const state = buildDragState(clip, left, 'move', e);
      setDragState(state);
      dragInfoRef.current = state;
    },
    [buildDragState]
  );

  // Global pointer handlers for clip drags (move + resize) with live
  // snapping, cross-track targeting, and preview state for ghost rendering.
  useEffect(() => {
    if (!dragState) return;

    const onMove = (e: MouseEvent | TouchEvent) => {
      const info = dragInfoRef.current;
      if (!info) return;

      const point = 'touches' in e ? e.touches[0] : (e as MouseEvent);
      const { clientX, clientY } = point;
      const next: DragState = { ...info, currentX: clientX };

      if (!next.active) {
        const travel = Math.hypot(
          clientX - info.initialX,
          clientY - info.initialY
        );
        if (travel >= DRAG_ACTIVATION_PX) {
          next.active = true;
        }
      }

      if (next.active) {
        // Stop touch scrolling while a drag is in flight
        if (e.cancelable) e.preventDefault();

        const deltaTime = (clientX - next.initialX) / PIXELS_PER_SECOND;
        const initialLeftTime = next.initialLeft / PIXELS_PER_SECOND;

        if (next.handle === 'move') {
          const clipDuration = next.initialEnd - next.initialStart;
          let leftTime = Math.max(0, initialLeftTime + deltaTime);

          // Snap whichever clip edge is closest to a target: try the leading
          // edge first, then the trailing edge.
          const startSnap = snapTime(leftTime, next.clipId);
          if (startSnap.guide) {
            leftTime = startSnap.snapped;
          } else {
            const endSnap = snapTime(leftTime + clipDuration, next.clipId);
            if (endSnap.guide) {
              leftTime = Math.max(0, endSnap.snapped - clipDuration);
            }
          }

          next.previewTimelineStart = leftTime;
          next.previewLeft = leftTime * PIXELS_PER_SECOND;
          next.previewWidth = clipDuration * PIXELS_PER_SECOND;

          // Vertical position decides the target track
          const el = document.elementFromPoint(clientX, clientY);
          const laneTrackId = el
            ?.closest('[data-track-id]')
            ?.getAttribute('data-track-id');
          if (laneTrackId) {
            next.targetTrackId = laneTrackId;
          }
        } else if (next.handle === 'left') {
          // Trim the in-point; the left edge follows the pointer
          const clampStart = (value: number) =>
            Math.min(
              Math.max(0, next.initialStart - initialLeftTime, value),
              next.initialEnd - MIN_CLIP_DURATION
            );

          let newStart = clampStart(next.initialStart + deltaTime);
          let edgeTime = initialLeftTime + (newStart - next.initialStart);
          const snap = snapTime(edgeTime, next.clipId);
          if (snap.guide) {
            newStart = clampStart(
              next.initialStart + (snap.snapped - initialLeftTime)
            );
            edgeTime = initialLeftTime + (newStart - next.initialStart);
          }

          next.previewStart = newStart;
          next.previewLeft = edgeTime * PIXELS_PER_SECOND;
          next.previewWidth = (next.initialEnd - newStart) * PIXELS_PER_SECOND;
        } else {
          // Trim the out-point; the right edge follows the pointer
          const clampEnd = (value: number) =>
            Math.max(
              Math.min(next.mediaDuration, value),
              next.initialStart + MIN_CLIP_DURATION
            );

          let newEnd = clampEnd(next.initialEnd + deltaTime);
          const edgeTime = initialLeftTime + (newEnd - next.initialStart);
          const snap = snapTime(edgeTime, next.clipId);
          if (snap.guide) {
            newEnd = clampEnd(
              next.initialStart + (snap.snapped - initialLeftTime)
            );
          }

          next.previewEnd = newEnd;
          next.previewLeft = next.initialLeft;
          next.previewWidth = (newEnd - next.initialStart) * PIXELS_PER_SECOND;
        }
      }

      setDragState(next);
      dragInfoRef.current = next;
    };

    const onUp = async () => {
      const info = dragInfoRef.current;
      setDragState(null);
      dragInfoRef.current = null;
      clearGuides();

      // A press that never travelled is a click; selection handles it.
      if (!info || !info.active) return;

      try {
        if (info.handle === 'move') {
          const targetTrack = timeline?.tracks.find(
            (t) => t.id === info.targetTrackId
          );
          if (!targetTrack || targetTrack.isLocked) return;

          const clipDuration = info.initialEnd - info.initialStart;
          const trackClips = (timeline?.clips || []).filter(
            (c) => c.TimelineTrackRef === info.targetTrackId
          );
          const timelineStart = findNonOverlappingTimelineStart(
            trackClips,
            info.previewTimelineStart,
            clipDuration,
            info.clipId
          );

          if (info.targetTrackId === info.sourceTrackId) {
            const previousStart =
              info.initialTimelineStart ?? info.initialLeft / PIXELS_PER_SECOND;
            if (Math.abs(timelineStart - previousStart) > 0.001) {
              await updateClipPosition(info.clipId, timelineStart);
            }
          } else {
            await moveClipToTrack(
              info.clipId,
              info.targetTrackId,
              timelineStart
            );
          }
        } else {
          const finalStart = info.previewStart;
          const finalEnd = info.previewEnd;
          if (
            finalStart === info.initialStart &&
            finalEnd === info.initialEnd
          ) {
            return;
          }

          await updateClipTimes(info.clipId, finalStart, finalEnd);

          // Keep the right edge anchored when trimming the in-point of an
          // absolutely-positioned clip.
          if (info.handle === 'left' && info.initialTimelineStart != null) {
            const newTimelineStart = Math.max(
              0,
              info.initialTimelineStart + (finalStart - info.initialStart)
            );
            if (
              Math.abs(newTimelineStart - info.initialTimelineStart) > 0.001
            ) {
              await updateClipPosition(info.clipId, newTimelineStart);
            }
          }
        }
      } catch (error) {
        console.error('Failed to apply clip drag', error);
      }
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
  }, [
    dragState,
    timeline?.clips,
    timeline?.tracks,
    updateClipTimes,
    updateClipPosition,
    moveClipToTrack,
    snapTime,
    clearGuides,
  ]);

  // Double-click opens the caption editor for caption clips
  const handleClipDoubleClick = useCallback((clip: TimelineClip) => {
    if (!clip.CaptionRef) return;
    const caption = (
      clip as TimelineClip & { expand?: { CaptionRef?: Caption } }
    ).expand?.CaptionRef;
    if (caption) {
      setEditingCaption(caption);
    }
  }, []);

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

  const handleTrackDelete = useCallback((trackId: string) => {
    setTrackToDelete(trackId);
    setTrackDeleteDialogOpen(true);
  }, []);

  const handleConfirmTrackDelete = useCallback(async () => {
    if (!trackToDelete) return;
    setIsDeletingTrack(true);
    try {
      await deleteTrack(trackToDelete, true);
      setTrackDeleteDialogOpen(false);
      setTrackToDelete(null);
    } catch (error) {
      console.error('Failed to delete track', error);
      setTrackDeleteDialogOpen(false);
      setTrackToDelete(null);
    } finally {
      setIsDeletingTrack(false);
    }
  }, [trackToDelete, deleteTrack]);

  // Bulk clip delete handler
  const handleConfirmClipDelete = useCallback(async () => {
    setIsDeletingClips(true);
    try {
      await removeSelectedClips();
      setClipDeleteDialogOpen(false);
    } catch (error) {
      console.error('Failed to delete clips', error);
      setClipDeleteDialogOpen(false);
    } finally {
      setIsDeletingClips(false);
    }
  }, [removeSelectedClips]);

  // Drag and drop from the media library (HTML5 drag events)
  const handleTrackDragOver = useCallback(
    (trackId: string, e: React.DragEvent) => {
      e.preventDefault();
      // Live snap guides while dragging library items over the timeline
      if (trackAreaRef.current) {
        const rect = trackAreaRef.current.getBoundingClientRect();
        const candidate = Math.max(
          0,
          (e.clientX - rect.left) / PIXELS_PER_SECOND
        );
        snapTime(candidate, undefined);
      }
    },
    [snapTime]
  );

  const parseLibraryDragData = useCallback((e: React.DragEvent) => {
    try {
      const json = e.dataTransfer.getData('application/json');
      if (!json) return null;
      const data = JSON.parse(json);
      if (
        data?.type === 'media-clip' &&
        data.mediaId &&
        data.start != null &&
        data.end != null
      ) {
        return data as {
          type: 'media-clip';
          clipId?: string;
          mediaId: string;
          start: number;
          end: number;
        };
      }
      if (
        data?.type === 'media-full' &&
        data.mediaId &&
        typeof data.duration === 'number'
      ) {
        return data as {
          type: 'media-full';
          mediaId: string;
          duration: number;
        };
      }
    } catch {
      /* ignore */
    }
    return null;
  }, []);

  const handleTrackDrop = useCallback(
    async (trackId: string, e: React.DragEvent) => {
      e.preventDefault();

      const track = sortedTracks.find((t) => t.id === trackId);
      if (!track || track.isLocked || !trackAreaRef.current) {
        clearGuides();
        return;
      }

      const rect = trackAreaRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const candidateTime = Math.max(0, x / PIXELS_PER_SECOND);

      // Drop from library (either a media clip or a full-length media)
      const dragData = parseLibraryDragData(e);
      if (!dragData) {
        clearGuides();
        return;
      }

      try {
        const trackClips = (timeline?.clips || []).filter(
          (c) => c.TimelineTrackRef === trackId
        );
        const start = dragData.type === 'media-clip' ? dragData.start : 0;
        const end =
          dragData.type === 'media-clip' ? dragData.end : dragData.duration;
        const clipDur = end - start;
        const { snapped } = snapTime(candidateTime, undefined);
        const timelineStart = findNonOverlappingTimelineStart(
          trackClips,
          snapped,
          clipDur
        );
        const mediaClipId =
          dragData.type === 'media-clip' ? dragData.clipId : undefined;
        await addClip(
          dragData.mediaId,
          start,
          end,
          mediaClipId,
          trackId,
          timelineStart
        );
      } catch (error) {
        console.error('Failed to add clip from drop', error);
      } finally {
        clearGuides();
      }
    },
    [
      sortedTracks,
      timeline?.clips,
      snapTime,
      addClip,
      parseLibraryDragData,
      clearGuides,
    ]
  );

  const handleTimelineClick = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!trackAreaRef.current) return;
      const rect = trackAreaRef.current.getBoundingClientRect();
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
      clearClipSelection();

      // Pressing a lane selects it as the insertion target
      const laneTrackId = (e.target as HTMLElement)
        .closest?.('[data-track-id]')
        ?.getAttribute('data-track-id');
      if (laneTrackId) {
        setSelectedTrackId(laneTrackId);
      }
    },
    [handleTimelineClick, dragState, clearClipSelection, setSelectedTrackId]
  );

  useEffect(() => {
    if (!isScrubbing) return;

    const handleMouseMove = (e: MouseEvent | TouchEvent) => {
      if (!trackAreaRef.current) return;
      const rect = trackAreaRef.current.getBoundingClientRect();
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

  // Show empty state if no tracks exist
  const hasNoTracks = sortedTracks.length === 0;
  const selectionCount = selectedClipIds.size;

  return (
    <>
      {/* Track Delete Dialog */}
      <AlertDialog
        open={trackDeleteDialogOpen}
        onOpenChange={(open) => {
          setTrackDeleteDialogOpen(open);
          if (!open) setTrackToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Track</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this track? All clips on this
              track will also be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingTrack}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmTrackDelete}
              disabled={isDeletingTrack}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingTrack ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Clip Delete Dialog */}
      <AlertDialog
        open={clipDeleteDialogOpen}
        onOpenChange={setClipDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Clips</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectionCount} clip
              {selectionCount === 1 ? '' : 's'}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingClips}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmClipDelete}
              disabled={isDeletingClips}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingClips ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex flex-col w-full bg-background border rounded-lg overflow-hidden shadow-inner relative group/timeline">
        {/* Selection toolbar (replaces single deselect button) */}
        {selectionCount > 0 && (
          <div className="absolute top-2 right-2 z-50 flex items-center gap-2 opacity-0 group-hover/timeline:opacity-100 transition-opacity">
            <span className="text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded shadow">
              {selectionCount} selected
            </span>
            <Button
              variant="secondary"
              size="icon"
              className="h-8 w-8 rounded-full shadow-lg"
              onClick={(e) => {
                e.stopPropagation();
                clearClipSelection();
              }}
              title="Clear Selection"
            >
              <X className="h-4 w-4" />
            </Button>
            <Button
              variant="destructive"
              size="icon"
              className="h-8 w-8 rounded-full shadow-lg"
              onClick={(e) => {
                e.stopPropagation();
                setClipDeleteDialogOpen(true);
              }}
              title="Delete Selected Clips"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Timeline Area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Track Headers Sidebar */}
          <div
            className="flex-shrink-0 border-r bg-muted/20 transition-[width] duration-200"
            style={{
              width: headersCollapsed
                ? TRACK_HEADER_WIDTH_COLLAPSED
                : TRACK_HEADER_WIDTH,
            }}
          >
            {/* Ruler Header Spacer + collapse toggle */}
            <div
              className={cn(
                'h-8 border-b bg-muted/30 flex items-center',
                headersCollapsed ? 'justify-center' : 'justify-between px-2'
              )}
            >
              {!headersCollapsed && (
                <span className="text-xs text-muted-foreground font-medium">
                  Tracks
                </span>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground"
                onClick={() => setHeadersCollapsed(!headersCollapsed)}
                title={
                  headersCollapsed
                    ? 'Expand track headers'
                    : 'Collapse track headers'
                }
              >
                {headersCollapsed ? (
                  <PanelLeftOpen className="h-3.5 w-3.5" />
                ) : (
                  <PanelLeftClose className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>

            {/* Track Headers */}
            <div
              className="overflow-y-auto"
              style={{ maxHeight: 'calc(100% - 2rem)' }}
            >
              {hasNoTracks
                ? !headersCollapsed && (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      No tracks yet. Create one to get started.
                    </div>
                  )
                : sortedTracks.map((track) => (
                    <TrackHeader
                      key={track.id}
                      track={track}
                      compact={headersCollapsed}
                      isSelected={selectedTrackId === track.id}
                      onSelect={() =>
                        setSelectedTrackId(
                          selectedTrackId === track.id ? null : track.id
                        )
                      }
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
                  ))}

              {/* Add Track Button */}
              <div className="p-2 border-t">
                <Button
                  variant="outline"
                  size={headersCollapsed ? 'icon' : 'sm'}
                  className={
                    headersCollapsed ? 'w-8 h-8 mx-auto flex' : 'w-full'
                  }
                  onClick={handleCreateTrack}
                  disabled={sortedTracks.length >= MAX_TIMELINE_TRACKS}
                  title={
                    sortedTracks.length >= MAX_TIMELINE_TRACKS
                      ? `Maximum of ${MAX_TIMELINE_TRACKS} tracks`
                      : 'Add Track'
                  }
                >
                  <Plus className="h-4 w-4" />
                  {!headersCollapsed && <span className="ml-2">Add Track</span>}
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
                        selectedClipIds={selectedClipIds}
                        onClipSelect={handleClipSelect}
                        onClipMoveStart={handleMoveStart}
                        onClipResizeStart={handleResizeStart}
                        onClipDoubleClick={handleClipDoubleClick}
                        onDragOver={(e) => handleTrackDragOver(track.id, e)}
                        onDrop={(e) => handleTrackDrop(track.id, e)}
                        resizeOverride={
                          dragState?.active && dragState.handle !== 'move'
                            ? {
                                clipId: dragState.clipId,
                                left: dragState.previewLeft,
                                width: dragState.previewWidth,
                              }
                            : null
                        }
                        movingClipId={
                          dragState?.active && dragState.handle === 'move'
                            ? dragState.clipId
                            : null
                        }
                        isDropTarget={
                          dragState?.active &&
                          dragState.handle === 'move' &&
                          dragState.targetTrackId === track.id
                        }
                        isSelected={selectedTrackId === track.id}
                      />
                    );
                  })
                )}
              </div>

              {/* Move Drag Ghost */}
              {dragState?.active &&
                dragState.handle === 'move' &&
                (() => {
                  const targetIndex = sortedTracks.findIndex(
                    (t) => t.id === dragState.targetTrackId
                  );
                  if (targetIndex === -1) return null;
                  const blocked = sortedTracks[targetIndex].isLocked;
                  return (
                    <div
                      className={cn(
                        'absolute z-[15] pointer-events-none rounded-sm border-2',
                        blocked
                          ? 'border-destructive bg-destructive/20'
                          : 'border-primary bg-primary/30'
                      )}
                      style={{
                        left: dragState.previewLeft,
                        width: dragState.previewWidth,
                        top: RULER_HEIGHT + targetIndex * TRACK_HEIGHT,
                        height: TRACK_HEIGHT,
                      }}
                    >
                      <div className="absolute top-1 left-1.5 text-[10px] font-mono text-white drop-shadow whitespace-nowrap">
                        {formatTime(dragState.previewTimelineStart)}
                      </div>
                    </div>
                  );
                })()}

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

      {/* Caption editor for caption clips (double-click) */}
      {timeline && (
        <CaptionEditorModal
          open={!!editingCaption}
          onOpenChange={(open) => {
            if (!open) setEditingCaption(null);
          }}
          workspaceId={timeline.WorkspaceRef}
          caption={editingCaption}
          onSaved={async () => {
            // Reload so clips pick up the updated caption expansion
            await refreshTimeline();
          }}
        />
      )}
    </>
  );
}
