'use client';

import React, {
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';
import { useTimeline } from '@/hooks/use-timeline';
import { cn } from '@/lib/utils';
import {
  X,
  Plus,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  ZoomIn,
  ZoomOut,
  Maximize2,
  BetweenHorizontalStart,
  ArrowRightFromLine,
  Replace,
} from 'lucide-react';
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
import {
  MAX_TIMELINE_TRACKS,
  compositeOffsetAtSourceTime,
  computeNestedTimelineDuration,
  findNonOverlappingTimelineStart,
  getClipRanges,
  getClipSegments,
  getClipTimelineDuration,
  getSortedTrackClips,
  planClipDrop,
  sourceTimeAtCompositeOffset,
} from '@project/shared';
import type {
  Caption,
  ClipDropMode,
  ClipDropPlan,
  CompositeSegment,
  TimelineClip,
} from '@project/shared';
import { TrackLane } from './track-lane';
import { TrackHeader } from './track-header';
import { SnapGuide } from './snap-guide';
import { useSnap } from './use-snap';
import { CaptionEditorModal } from '@/components/captions';

const DEFAULT_PPS = 20; // pixels per second at 100% zoom
const MIN_PPS = 2; // most zoomed out (high-level overview)
const MAX_PPS = 200; // most zoomed in (precise edits)
const ZOOM_FACTOR = 1.5; // multiplier per zoom-in/out step
const PPS_STORAGE_KEY = 'timeline-editor:pixels-per-second';
const MIN_CLIP_DURATION = 0.5;
const TRACK_HEADER_WIDTH = 200; // pixels
const TRACK_HEADER_WIDTH_COLLAPSED = 48; // pixels
const RULER_HEIGHT = 32; // h-8
const TRACK_HEIGHT = 64; // h-16
const DRAG_ACTIVATION_PX = 4; // pointer travel before a press becomes a drag

// Ruler tick steps in seconds. The smallest whose on-screen spacing clears
// MIN_LABEL_PX becomes the labeled interval, keeping the ruler readable at any
// zoom (dense seconds when zoomed in, sparse minutes when zoomed out).
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
const MIN_LABEL_PX = 56;
const MIN_MINOR_PX = 8;

// Drop-mode picker entries: the persistent toggle (the only way to switch
// modes on touch devices) plus the modifier that overrides it mid-drag.
const DROP_MODE_OPTIONS: Array<{
  mode: ClipDropMode;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
}> = [
  {
    mode: 'insert',
    icon: BetweenHorizontalStart,
    title: 'Insert drop mode — overlapped clips slide right to make room',
  },
  {
    mode: 'shift',
    icon: ArrowRightFromLine,
    title:
      'Shift drop mode — the clip and every clip after it move together (hold Shift while dragging)',
  },
  {
    mode: 'overwrite',
    icon: Replace,
    title:
      'Overwrite drop mode — clips in the way are trimmed or removed (hold Alt/Option while dragging)',
  },
];

function clampZoom(value: number): number {
  return Math.min(Math.max(value, MIN_PPS), MAX_PPS);
}

// Anchored zoom adjusts scrollLeft after layout; run before paint to avoid a
// visible jump. Falls back to useEffect during SSR where layout effects warn.
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

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
  /**
   * Effective on-timeline duration at drag start: the gap-skipping segment
   * sum for composite clips, end - start otherwise
   */
  timelineDuration: number;
  /**
   * Composite clip's FULL edit list at drag start (never modified by a
   * trim). Resize handles move the clip's start/end window through it in
   * effective (timeline) time — inward to trim, back outward to untrim.
   */
  segments?: CompositeSegment[];
  /**
   * The start/end window's edges as offsets in the full edit list's
   * composite (gap-skipping) time, and the list's total effective length —
   * the coordinate system composite resize drags operate in.
   */
  windowStartOffset: number;
  windowEndOffset: number;
  fullDuration: number;
  /**
   * Left-edge floor: the previous clip's range end on this track. Extending
   * a clip leftward stops here so it can never overlap its neighbor.
   */
  minTimelineStart: number;
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
    applyClipDrop,
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
  const [altPressed, setAltPressed] = useState(false);
  const [metaPressed, setMetaPressed] = useState(false);
  const [headersCollapsed, setHeadersCollapsed] = useState(false);
  // Sticky drop mode from the toolbar picker; the modifier keys override it
  // for the duration of a drag (Shift → shift, Alt/Option → overwrite).
  const [dropMode, setDropMode] = useState<ClipDropMode>('insert');

  // Timeline zoom (pixels per second). Adjustable so users can zoom in for
  // precise trims or out for a high-level overview of a long timeline.
  const [pixelsPerSecond, setPixelsPerSecond] = useState(DEFAULT_PPS);
  // Pending cursor anchor so a zoom keeps the same time under the pointer.
  const zoomAnchorRef = useRef<{ time: number; offsetX: number } | null>(null);

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

  // Restore the persisted zoom level on mount (after hydration to avoid a
  // server/client mismatch).
  useEffect(() => {
    const stored = window.localStorage.getItem(PPS_STORAGE_KEY);
    if (!stored) return;
    const parsed = parseFloat(stored);
    if (!Number.isNaN(parsed)) setPixelsPerSecond(clampZoom(parsed));
  }, []);

  // Persist the zoom level so it carries across sessions.
  useEffect(() => {
    window.localStorage.setItem(PPS_STORAGE_KEY, String(pixelsPerSecond));
  }, [pixelsPerSecond]);

  // After a zoom changes the content width, restore scroll so the anchored
  // time stays under the cursor (or viewport center for button/key zooms).
  useIsomorphicLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const container = containerRef.current;
    if (!anchor || !container) return;
    container.scrollLeft = anchor.time * pixelsPerSecond - anchor.offsetX;
    zoomAnchorRef.current = null;
  }, [pixelsPerSecond]);

  // Set a new zoom level, recording the anchor point to preserve on screen.
  const applyZoom = useCallback(
    (nextValue: number, anchorClientX?: number) => {
      const clamped = clampZoom(nextValue);
      if (clamped === pixelsPerSecond) return;
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const offsetX =
          anchorClientX != null
            ? anchorClientX - rect.left
            : container.clientWidth / 2;
        zoomAnchorRef.current = {
          time: (container.scrollLeft + offsetX) / pixelsPerSecond,
          offsetX,
        };
      }
      setPixelsPerSecond(clamped);
    },
    [pixelsPerSecond]
  );

  const handleZoomIn = useCallback(
    () => applyZoom(pixelsPerSecond * ZOOM_FACTOR),
    [applyZoom, pixelsPerSecond]
  );
  const handleZoomOut = useCallback(
    () => applyZoom(pixelsPerSecond / ZOOM_FACTOR),
    [applyZoom, pixelsPerSecond]
  );
  const handleZoomReset = useCallback(
    () => applyZoom(DEFAULT_PPS),
    [applyZoom]
  );
  const handleZoomFit = useCallback(() => {
    const container = containerRef.current;
    if (!container || container.clientWidth <= 0) return;
    // Fit the whole timeline (min 60s, matching displayDuration) into the view,
    // leaving a small margin so the final tick label isn't clipped.
    applyZoom((container.clientWidth - 16) / Math.max(duration, 60));
  }, [applyZoom, duration]);

  // Ctrl/Cmd + wheel (and trackpad pinch, which arrives as ctrl+wheel) zooms,
  // anchored at the cursor. Plain wheel keeps native scrolling.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      applyZoom(pixelsPerSecond * Math.exp(-e.deltaY * 0.002), e.clientX);
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [applyZoom, pixelsPerSecond]);

  // Keyboard zoom: +/- to step, 0 to fit. Ignored while typing or when a
  // modifier is held (so browser zoom shortcuts still work).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        handleZoomIn();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        handleZoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        handleZoomFit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleZoomIn, handleZoomOut, handleZoomFit]);

  // Initialize snap engine. Cmd/Ctrl disables snapping (Shift is the
  // shift-drop-mode modifier while dragging clips).
  const { snapTime, activeGuides, clearGuides } = useSnap({
    clips: timeline?.clips || [],
    currentTime,
    pixelsPerSecond: pixelsPerSecond,
    threshold: 8,
    enabled: !metaPressed,
  });

  // Track drag modifiers (Shift → shift mode, Alt/Option → overwrite mode,
  // Cmd/Ctrl → no snapping) + multi-select keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setShiftPressed(true);
      }
      if (e.key === 'Alt') {
        setAltPressed(true);
        // Keep the browser from focusing its menu bar mid-drag
        e.preventDefault();
      }
      if (e.key === 'Meta' || e.key === 'Control') {
        setMetaPressed(true);
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
      if (e.key === 'Alt') {
        setAltPressed(false);
      }
      if (e.key === 'Meta' || e.key === 'Control') {
        setMetaPressed(false);
      }
    };

    // Alt-Tab and friends can steal the matching keyup; a stuck modifier
    // would silently change every following drop.
    const handleBlur = () => {
      setShiftPressed(false);
      setAltPressed(false);
      setMetaPressed(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
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
    () => displayDuration * pixelsPerSecond,
    [displayDuration, pixelsPerSecond]
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

  // The mode a release right now would apply: modifier keys override the
  // toolbar pick for the duration of the drag.
  const effectiveDropMode: ClipDropMode = altPressed
    ? 'overwrite'
    : shiftPressed
      ? 'shift'
      : dropMode;

  // The lane a release would drop onto. Shift mode moves a block within the
  // clip's own track, so it pins the target back to the source lane no
  // matter where the pointer wanders.
  const effectiveTargetTrackId =
    dragState?.active && dragState.handle === 'move'
      ? effectiveDropMode === 'shift'
        ? dragState.sourceTrackId
        : dragState.targetTrackId
      : null;

  // The dragged clip's CURRENT effective duration, resolved from the live
  // timeline rather than the pointer-down snapshot — a realtime edit that
  // trims the clip mid-drag must reshape the drop footprint, not reserve
  // stale space. Null when the clip was deleted mid-drag (nothing to drop).
  const dragClipDuration = useMemo(() => {
    if (!dragState || dragState.handle !== 'move' || !timeline) return null;
    const clip = timeline.clips.find((c) => c.id === dragState.clipId);
    return clip ? getClipTimelineDuration(clip) : null;
  }, [dragState, timeline]);

  // Live resolution of the in-flight move drag: where the dragged clip lands
  // and what happens to every other clip on the target lane. Drives both the
  // mid-drag preview and the ghost label; onUp recomputes the same plan from
  // the same inputs to persist exactly what was previewed.
  const dropPlan = useMemo<ClipDropPlan | null>(() => {
    if (
      !dragState?.active ||
      dragState.handle !== 'move' ||
      !timeline ||
      dragClipDuration === null
    ) {
      return null;
    }
    const trackId =
      effectiveDropMode === 'shift'
        ? dragState.sourceTrackId
        : dragState.targetTrackId;
    const targetTrack = timeline.tracks.find((t) => t.id === trackId);
    if (!targetTrack || targetTrack.isLocked) return null;
    const trackClips = timeline.clips.filter(
      (c) => (c.TimelineTrackRef || '') === trackId
    );
    return planClipDrop(
      trackClips,
      dragState.clipId,
      dragState.previewTimelineStart,
      dragClipDuration,
      effectiveDropMode
    );
  }, [dragState, timeline, effectiveDropMode, dragClipDuration]);

  // Per-clip fates for the target lane, in the shape TrackLane consumes
  const dropPreview = useMemo(() => {
    if (!dropPlan) return null;
    return {
      moves: new Map(dropPlan.moves.map((m) => [m.clipId, m.timelineStart])),
      trims: new Map(dropPlan.trims.map((t) => [t.clipId, t])),
      removals: new Set(dropPlan.removals),
    };
  }, [dropPlan]);

  // One-line answer to "what will releasing here do?"
  const dropImpactLabel = useMemo(() => {
    if (!dropPlan) return null;
    if (dropPlan.mode === 'overwrite') {
      const parts: string[] = [];
      if (dropPlan.trims.length > 0) {
        parts.push(`trims ${dropPlan.trims.length}`);
      }
      if (dropPlan.removals.length > 0) {
        parts.push(`removes ${dropPlan.removals.length}`);
      }
      return parts.length > 0 ? `Overwrite · ${parts.join(', ')}` : 'Overwrite';
    }
    if (dropPlan.mode === 'shift') {
      return dropPlan.moves.length > 0
        ? `Shift · ${dropPlan.moves.length} follow`
        : 'Shift';
    }
    return dropPlan.moves.length > 0
      ? `Insert · pushes ${dropPlan.moves.length}`
      : 'Insert';
  }, [dropPlan]);

  // Build the shared initial drag state for both resize and move drags
  const buildDragState = useCallback(
    (
      clip: TimelineClip,
      left: number,
      handle: DragState['handle'],
      e: React.MouseEvent | React.TouchEvent
    ): DragState => {
      const point = 'touches' in e ? e.touches[0] : e;
      // Caption clips trim against the caption's own duration;
      // nested-timeline clips against the source timeline's content duration
      const nestedData = clip.SourceTimelineRef
        ? timeline?.nestedTimelines?.[clip.SourceTimelineRef]
        : undefined;
      const mediaDuration = clip.SourceTimelineRef
        ? nestedData
          ? computeNestedTimelineDuration(nestedData)
          : clip.end
        : clip.CaptionRef
          ? clip.expand?.CaptionRef?.duration || clip.end
          : clip.expand?.MediaRef?.duration || 1000; // Fallback if unknown
      const trackId = clip.TimelineTrackRef || '';

      // Composite clips resize in effective (gap-skipping) time against
      // their full edit list; clip.start/end are a window over it, expressed
      // here as composite-time offsets so trims can be reversed (untrim)
      const segments = clip.SourceTimelineRef
        ? undefined
        : getClipSegments(clip);
      const hasSegments = !!segments && segments.length > 0;
      const windowStartOffset = hasSegments
        ? compositeOffsetAtSourceTime(segments!, clip.start)
        : 0;
      const windowEndOffset = hasSegments
        ? compositeOffsetAtSourceTime(segments!, clip.end)
        : 0;
      const fullDuration = hasSegments
        ? segments!.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0)
        : 0;
      const timelineDuration = getClipTimelineDuration(clip);

      // The previous clip's range end on this track: the floor for
      // left-edge drags, so extending left can never overlap a neighbor
      const trackClips = (timeline?.clips || []).filter(
        (c) => (c.TimelineTrackRef || '') === trackId
      );
      const sorted = getSortedTrackClips(trackClips);
      const ranges = getClipRanges(trackClips);
      const leftTime = left / pixelsPerSecond;
      let minTimelineStart = 0;
      sorted.forEach((c, i) => {
        if (c.id !== clip.id && ranges[i].end <= leftTime + 0.001) {
          minTimelineStart = Math.max(minTimelineStart, ranges[i].end);
        }
      });

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
        timelineDuration,
        segments: hasSegments ? segments : undefined,
        windowStartOffset,
        windowEndOffset,
        fullDuration,
        minTimelineStart,
        targetTrackId: trackId,
        previewLeft: left,
        previewWidth: timelineDuration * pixelsPerSecond,
        previewTimelineStart: left / pixelsPerSecond,
        previewStart: clip.start,
        previewEnd: clip.end,
      };
    },
    [pixelsPerSecond, timeline]
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

        const deltaTime = (clientX - next.initialX) / pixelsPerSecond;
        const initialLeftTime = next.initialLeft / pixelsPerSecond;

        if (next.handle === 'move') {
          // Footprint from the live clip, not the pointer-down snapshot — a
          // realtime edit can trim the dragged clip mid-drag.
          const liveClip = timeline?.clips.find((c) => c.id === next.clipId);
          const clipDuration = liveClip
            ? getClipTimelineDuration(liveClip)
            : next.timelineDuration;
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
          next.previewLeft = leftTime * pixelsPerSecond;
          next.previewWidth = clipDuration * pixelsPerSecond;

          // Vertical position decides the target track
          const el = document.elementFromPoint(clientX, clientY);
          const laneTrackId = el
            ?.closest('[data-track-id]')
            ?.getAttribute('data-track-id');
          if (laneTrackId) {
            next.targetTrackId = laneTrackId;
          }
        } else if (next.handle === 'left') {
          // Trim the in-point; the left edge follows the pointer. Never past
          // the previous clip's end (extending left must not overlap it).
          if (next.segments) {
            // Composite: the pointer moves in effective time; shift the
            // window's in-point through the full edit list. Negative values
            // untrim — the window can re-open all the way to the list head.
            const windowLength = next.windowEndOffset - next.windowStartOffset;
            const clampOffset = (value: number) =>
              Math.min(
                Math.max(
                  -next.windowStartOffset,
                  next.minTimelineStart - initialLeftTime,
                  value
                ),
                windowLength - MIN_CLIP_DURATION
              );

            let headTrim = clampOffset(deltaTime);
            const snap = snapTime(initialLeftTime + headTrim, next.clipId);
            if (snap.guide) {
              headTrim = clampOffset(snap.snapped - initialLeftTime);
            }

            next.previewStart = sourceTimeAtCompositeOffset(
              next.segments,
              next.windowStartOffset + headTrim
            );
            next.previewLeft = (initialLeftTime + headTrim) * pixelsPerSecond;
            next.previewWidth = (windowLength - headTrim) * pixelsPerSecond;
          } else {
            const clampStart = (value: number) =>
              Math.min(
                Math.max(
                  0,
                  next.initialStart + (next.minTimelineStart - initialLeftTime),
                  next.initialStart - initialLeftTime,
                  value
                ),
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
            next.previewLeft = edgeTime * pixelsPerSecond;
            next.previewWidth = (next.initialEnd - newStart) * pixelsPerSecond;
          }
        } else {
          // Trim the out-point; the right edge follows the pointer
          if (next.segments) {
            // Composite: the window's out-point follows the pointer in
            // effective time, capped at the full edit list's gap-skipping
            // length — so a trimmed clip can expand (untrim) back out.
            const windowLength = next.windowEndOffset - next.windowStartOffset;
            const clampLength = (value: number) =>
              Math.max(
                Math.min(next.fullDuration - next.windowStartOffset, value),
                MIN_CLIP_DURATION
              );

            let effLength = clampLength(windowLength + deltaTime);
            const snap = snapTime(initialLeftTime + effLength, next.clipId);
            if (snap.guide) {
              effLength = clampLength(snap.snapped - initialLeftTime);
            }

            next.previewEnd = sourceTimeAtCompositeOffset(
              next.segments,
              next.windowStartOffset + effLength
            );
            next.previewLeft = next.initialLeft;
            next.previewWidth = effLength * pixelsPerSecond;
          } else {
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
            next.previewWidth = (newEnd - next.initialStart) * pixelsPerSecond;
          }
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
          // Shift mode is a block move within the source track; the other
          // modes drop wherever the pointer is hovering.
          const targetTrackId =
            effectiveDropMode === 'shift'
              ? info.sourceTrackId
              : info.targetTrackId;
          const targetTrack = timeline?.tracks.find(
            (t) => t.id === targetTrackId
          );
          if (!targetTrack || targetTrack.isLocked) return;

          // Plan against the clip's live footprint — a realtime edit may
          // have trimmed it mid-drag; if it was deleted, there is nothing
          // left to drop.
          const draggedClip = timeline?.clips.find((c) => c.id === info.clipId);
          if (!draggedClip) return;

          // Same plan the preview showed (same pure function, same inputs)
          const trackClips = (timeline?.clips || []).filter(
            (c) => (c.TimelineTrackRef || '') === targetTrackId
          );
          const plan = planClipDrop(
            trackClips,
            info.clipId,
            info.previewTimelineStart,
            getClipTimelineDuration(draggedClip),
            effectiveDropMode
          );

          // A drop back onto the clip's own footprint changes nothing
          const previousStart =
            info.initialTimelineStart ?? info.initialLeft / pixelsPerSecond;
          const isNoOp =
            targetTrackId === info.sourceTrackId &&
            Math.abs(plan.timelineStart - previousStart) <= 0.001 &&
            plan.moves.length === 0 &&
            plan.trims.length === 0 &&
            plan.removals.length === 0;
          if (!isNoOp) {
            await applyClipDrop(info.clipId, targetTrackId, plan);
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

          // Composite trims persist only the start/end window — the edit
          // list is never modified, so the clip can always be expanded back
          // out to its full edit-list duration (untrim).

          // Keep the right edge anchored when trimming the in-point of an
          // absolutely-positioned clip: pin it at the previewed left edge.
          const newTimelineStart =
            info.handle === 'left' &&
            info.initialTimelineStart != null &&
            Math.abs(
              info.previewLeft / pixelsPerSecond - info.initialTimelineStart
            ) > 0.001
              ? Math.max(0, info.previewLeft / pixelsPerSecond)
              : undefined;

          const extras =
            newTimelineStart !== undefined
              ? { timelineStart: newTimelineStart }
              : undefined;

          await updateClipTimes(info.clipId, finalStart, finalEnd, extras);
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
    applyClipDrop,
    effectiveDropMode,
    snapTime,
    clearGuides,
    pixelsPerSecond,
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

  // Bulk clip delete handler; ripple closes the gaps the clips leave behind
  const handleConfirmClipDelete = useCallback(
    async (ripple: boolean) => {
      setIsDeletingClips(true);
      try {
        await removeSelectedClips(ripple);
        setClipDeleteDialogOpen(false);
      } catch (error) {
        console.error('Failed to delete clips', error);
        setClipDeleteDialogOpen(false);
      } finally {
        setIsDeletingClips(false);
      }
    },
    [removeSelectedClips]
  );

  // Drag and drop from the media library (HTML5 drag events)
  const handleTrackDragOver = useCallback(
    (trackId: string, e: React.DragEvent) => {
      e.preventDefault();
      // Live snap guides while dragging library items over the timeline
      if (trackAreaRef.current) {
        const rect = trackAreaRef.current.getBoundingClientRect();
        const candidate = Math.max(
          0,
          (e.clientX - rect.left) / pixelsPerSecond
        );
        snapTime(candidate, undefined);
      }
    },
    [snapTime, pixelsPerSecond]
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
      const candidateTime = Math.max(0, x / pixelsPerSecond);

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
      pixelsPerSecond,
    ]
  );

  const handleTimelineClick = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!trackAreaRef.current) return;
      const rect = trackAreaRef.current.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const x = clientX - rect.left;
      const time = Math.max(0, Math.min(displayDuration, x / pixelsPerSecond));
      setCurrentTime(time);
    },
    [displayDuration, setCurrentTime, pixelsPerSecond]
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
      const time = Math.max(0, Math.min(displayDuration, x / pixelsPerSecond));
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
  }, [isScrubbing, displayDuration, setCurrentTime, pixelsPerSecond]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Auto-scroll effect to keep playhead in view during playback
  useEffect(() => {
    if (isPlaying && containerRef.current && !isScrubbing) {
      const container = containerRef.current;
      const playheadX = currentTime * pixelsPerSecond;
      const scrollLeft = container.scrollLeft;
      const scrollRight = scrollLeft + container.clientWidth;

      // Use a small buffer so it doesn't hit the absolute edge
      const buffer = 40;

      if (playheadX > scrollRight - buffer || playheadX < scrollLeft + buffer) {
        container.scrollLeft = playheadX - container.clientWidth / 2;
      }
    }
  }, [currentTime, isPlaying, isScrubbing, pixelsPerSecond]);

  // Generate ruler ticks. The labeled interval and minor subdivisions adapt to
  // the zoom level so the ruler stays readable whether zoomed in or out.
  const ticks = useMemo(() => {
    const labeledStep =
      TICK_STEPS.find((step) => step * pixelsPerSecond >= MIN_LABEL_PX) ??
      TICK_STEPS[TICK_STEPS.length - 1];
    const minorStep =
      (labeledStep / 5) * pixelsPerSecond >= MIN_MINOR_PX
        ? labeledStep / 5
        : labeledStep;
    const majorEvery = Math.max(1, Math.round(labeledStep / minorStep));

    const count = Math.floor(displayDuration / minorStep);
    const items = [];
    for (let i = 0; i <= count; i++) {
      const time = i * minorStep;
      const isMajor = i % majorEvery === 0;
      items.push(
        <div
          key={i}
          className={cn(
            'absolute bottom-0 border-l border-muted-foreground/30',
            isMajor ? 'h-3' : 'h-1.5'
          )}
          style={{ left: time * pixelsPerSecond }}
        >
          {isMajor && (
            <span className="absolute -top-5 left-1 text-[10px] text-muted-foreground whitespace-nowrap">
              {formatTime(time)}
            </span>
          )}
        </div>
      );
    }
    return items;
  }, [displayDuration, pixelsPerSecond]);

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
              {selectionCount === 1 ? '' : 's'}? Ripple delete also shifts the
              following clips on each track left to close the gap. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingClips}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleConfirmClipDelete(true)}
              disabled={isDeletingClips}
              className="bg-destructive/80 text-destructive-foreground hover:bg-destructive/70"
            >
              {isDeletingClips ? 'Deleting...' : 'Ripple Delete'}
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => handleConfirmClipDelete(false)}
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

        {/* Drop mode + zoom controls */}
        <div className="absolute bottom-3 right-3 z-50 flex items-center gap-0.5 rounded-md border bg-background/90 px-0.5 py-0.5 shadow-md backdrop-blur supports-[backdrop-filter]:bg-background/70">
          {DROP_MODE_OPTIONS.map(({ mode, icon: Icon, title }) => (
            <Button
              key={mode}
              variant="ghost"
              size="icon"
              className={cn(
                'h-7 w-7',
                // Reflects the mode a release would use right now, so a held
                // modifier lights up its button mid-drag
                effectiveDropMode === mode && 'bg-accent text-accent-foreground'
              )}
              onClick={() => setDropMode(mode)}
              title={title}
            >
              <Icon className="h-4 w-4" />
            </Button>
          ))}
          <div className="mx-0.5 h-4 w-px bg-border" />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleZoomOut}
            disabled={pixelsPerSecond <= MIN_PPS}
            title="Zoom out (−)"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <button
            type="button"
            onClick={handleZoomReset}
            className="min-w-[3.25rem] px-1 text-center font-mono text-xs tabular-nums text-muted-foreground transition-colors hover:text-foreground"
            title="Reset to 100%"
          >
            {Math.round((pixelsPerSecond / DEFAULT_PPS) * 100)}%
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleZoomIn}
            disabled={pixelsPerSecond >= MAX_PPS}
            title="Zoom in (+)"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <div className="mx-0.5 h-4 w-px bg-border" />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleZoomFit}
            title="Fit timeline to view (0)"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>

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
                        pixelsPerSecond={pixelsPerSecond}
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
                        isDropTarget={effectiveTargetTrackId === track.id}
                        dropPreview={
                          effectiveTargetTrackId === track.id
                            ? dropPreview
                            : null
                        }
                        isSelected={selectedTrackId === track.id}
                      />
                    );
                  })
                )}
              </div>

              {/* Move Drag Ghost — colored by drop mode, labeled with the
                  planned landing time and what releasing will do */}
              {dragState?.active &&
                dragState.handle === 'move' &&
                (() => {
                  const targetIndex = sortedTracks.findIndex(
                    (t) => t.id === effectiveTargetTrackId
                  );
                  if (targetIndex === -1) return null;
                  const blocked = sortedTracks[targetIndex].isLocked;
                  const ghostTime = dropPlan
                    ? dropPlan.timelineStart
                    : dragState.previewTimelineStart;
                  return (
                    <div
                      className={cn(
                        'absolute z-[15] pointer-events-none rounded-sm border-2',
                        blocked
                          ? 'border-destructive bg-destructive/20'
                          : effectiveDropMode === 'overwrite'
                            ? 'border-destructive bg-destructive/25'
                            : effectiveDropMode === 'shift'
                              ? 'border-amber-500 bg-amber-500/25'
                              : 'border-primary bg-primary/30'
                      )}
                      style={{
                        left: ghostTime * pixelsPerSecond,
                        // Live footprint (a realtime edit can trim the clip
                        // mid-drag); previewWidth only updates on pointer moves
                        width:
                          (dragClipDuration ?? dragState.timelineDuration) *
                          pixelsPerSecond,
                        top: RULER_HEIGHT + targetIndex * TRACK_HEIGHT,
                        height: TRACK_HEIGHT,
                      }}
                    >
                      <div className="absolute top-1 left-1.5 text-[10px] font-mono text-white drop-shadow whitespace-nowrap">
                        {formatTime(ghostTime)}
                      </div>
                      <div
                        className={cn(
                          'absolute bottom-1 left-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium shadow whitespace-nowrap',
                          blocked || effectiveDropMode === 'overwrite'
                            ? 'bg-destructive text-destructive-foreground'
                            : effectiveDropMode === 'shift'
                              ? 'bg-amber-500 text-black'
                              : 'bg-primary text-primary-foreground'
                        )}
                      >
                        {blocked ? 'Locked track' : (dropImpactLabel ?? '')}
                      </div>
                    </div>
                  );
                })()}

              {/* Snap Guides */}
              {activeGuides.map((guide, index) => (
                <SnapGuide
                  key={`${guide.source}-${guide.time}-${index}`}
                  position={guide.time * pixelsPerSecond}
                  orientation="vertical"
                  label={formatTime(guide.time)}
                />
              ))}

              {/* Playhead */}
              <div
                className="absolute top-0 bottom-0 w-[2px] bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)] z-40 cursor-ew-resize group/playhead"
                style={{ left: currentTime * pixelsPerSecond }}
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
