'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  MIN_SEGMENT_SECONDS,
  slipSegments,
  trimSegment,
} from '@project/shared';
import { Trash2 } from 'lucide-react';
import type { Segment } from '@/components/timeline/segment-editor';
import { formatClipTime } from '@/utils/format-clip-time';
import { cn } from '@/lib/utils';

type DragMode = 'scrub' | 'move' | 'trim-start' | 'trim-end';

interface DragSession {
  pointerId: number;
  mode: DragMode;
  /** Segment index (into the normalized list); -1 for a scrub. */
  index: number;
  /** Snapshot of the committed segments at drag start. */
  origin: Segment[];
  startClientX: number;
  /** Source time under the pointer at drag start. */
  startTime: number;
  /** Set once the pointer moves past the threshold — distinguishes tap. */
  moved: boolean;
  /** move: the clamped slip delta; trim: the new (clamped) edge time. */
  value: number;
}

/** Pixels of travel before a press becomes a drag rather than a tap. */
const DRAG_THRESHOLD_PX = 3;

export interface ClipSegmentStripProps {
  /** The committed edit list (normalized, sorted). */
  segments: Segment[];
  /** Visible time window (respects the modal's zoom toggle). */
  displayRange: { from: number; to: number };
  selectedIndex: number | null;
  currentTime: number;
  markIn: number | null;
  markOut: number | null;
  mediaDuration: number;
  /** Images/legacy media have no upper time bound. */
  isImage?: boolean;
  onSelect: (index: number | null) => void;
  onScrub: (time: number) => void;
  /** Commit a single-segment slip; `delta` is already clamped to a legal move. */
  onMove: (index: number, delta: number) => void;
  /** Commit a single-edge trim to an absolute source time. */
  onTrim: (index: number, edge: 'start' | 'end', time: number) => void;
  onDelete: (index: number) => void;
}

/**
 * Interactive segment strip for the fine-tune modal. Beyond selecting and
 * scrubbing, it supports direct manipulation that mirrors the keyboard/button
 * ops: dragging a segment body slips it (same length, different source
 * content), dragging an edge trims it, and a per-segment button deletes it.
 *
 * Drags preview locally via the shared segment-edit functions and commit a
 * single history entry on pointer-up (so one gesture = one undo). A press that
 * doesn't cross {@link DRAG_THRESHOLD_PX} is treated as a tap: seek + select.
 */
export function ClipSegmentStrip({
  segments,
  displayRange,
  selectedIndex,
  currentTime,
  markIn,
  markOut,
  mediaDuration,
  isImage = false,
  onSelect,
  onScrub,
  onMove,
  onTrim,
  onDelete,
}: ClipSegmentStripProps) {
  const bounds = useMemo(
    () => (isImage ? {} : { mediaDuration }),
    [isImage, mediaDuration]
  );
  const hasUpperBound = !isImage && mediaDuration > 0;

  const stripRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<DragSession | null>(null);
  // Ephemeral segments shown while dragging; null when idle (show committed).
  const [preview, setPreview] = useState<Segment[] | null>(null);
  const displaySegments = preview ?? segments;

  const span = displayRange.to - displayRange.from;

  const toPct = useCallback(
    (t: number) => {
      if (span <= 0) return 0;
      return Math.min(100, Math.max(0, ((t - displayRange.from) / span) * 100));
    },
    [displayRange.from, span]
  );

  const pxToTime = useCallback(
    (clientX: number) => {
      const rect = stripRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return displayRange.from;
      const ratio = (clientX - rect.left) / rect.width;
      return displayRange.from + ratio * span;
    },
    [displayRange.from, span]
  );

  /** Legal [min, max] for one edge of a segment, matching trimSegment's rules. */
  const edgeRange = useCallback(
    (
      origin: Segment[],
      index: number,
      edge: 'start' | 'end'
    ): [number, number] => {
      const seg = origin[index];
      const prev = origin[index - 1];
      const next = origin[index + 1];
      if (edge === 'start') {
        return [prev ? prev.end : 0, seg.end - MIN_SEGMENT_SECONDS];
      }
      return [
        seg.start + MIN_SEGMENT_SECONDS,
        next ? next.start : hasUpperBound ? mediaDuration : Infinity,
      ];
    },
    [hasUpperBound, mediaDuration]
  );

  const beginDrag = useCallback(
    (e: React.PointerEvent, mode: DragMode, index: number) => {
      if (sessionRef.current) return; // ignore extra pointers mid-drag
      const time = pxToTime(e.clientX);
      const seg = index >= 0 ? segments[index] : null;
      sessionRef.current = {
        pointerId: e.pointerId,
        mode,
        index,
        origin: segments,
        startClientX: e.clientX,
        startTime: time,
        moved: false,
        value:
          mode === 'trim-start'
            ? (seg?.start ?? 0)
            : mode === 'trim-end'
              ? (seg?.end ?? 0)
              : 0,
      };
      try {
        stripRef.current?.setPointerCapture(e.pointerId);
      } catch {
        // pointer capture is best-effort (unsupported in some environments)
      }
      if (mode === 'scrub') {
        onSelect(null);
        onScrub(time);
      } else {
        onSelect(index);
      }
    },
    [pxToTime, segments, onSelect, onScrub]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const s = sessionRef.current;
      if (!s || e.pointerId !== s.pointerId) return;
      const time = pxToTime(e.clientX);

      if (s.mode === 'scrub') {
        onScrub(time);
        return;
      }
      if (
        !s.moved &&
        Math.abs(e.clientX - s.startClientX) < DRAG_THRESHOLD_PX
      ) {
        return;
      }
      s.moved = true;

      if (s.mode === 'move') {
        const { segments: next, applied } = slipSegments(
          s.origin,
          time - s.startTime,
          {
            index: s.index,
            ...bounds,
          }
        );
        s.value = applied;
        setPreview(next);
      } else {
        const edge = s.mode === 'trim-start' ? 'start' : 'end';
        const [min, max] = edgeRange(s.origin, s.index, edge);
        const clamped = Math.min(max, Math.max(min, time));
        s.value = clamped;
        setPreview(trimSegment(s.origin, s.index, { [edge]: clamped }, bounds));
      }
    },
    [pxToTime, onScrub, bounds, edgeRange]
  );

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      const s = sessionRef.current;
      if (!s || e.pointerId !== s.pointerId) return;
      try {
        stripRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        // no-op: capture may never have been granted
      }
      sessionRef.current = null;
      setPreview(null);

      if (s.mode === 'scrub') return;
      if (!s.moved) {
        // A tap on a segment: seek there (it was already selected).
        onScrub(s.startTime);
        return;
      }
      if (s.mode === 'move') {
        if (Math.abs(s.value) > 0.0005) onMove(s.index, s.value);
        return;
      }
      const edge = s.mode === 'trim-start' ? 'start' : 'end';
      const original =
        edge === 'start' ? s.origin[s.index].start : s.origin[s.index].end;
      if (Math.abs(s.value - original) > 0.0005) onTrim(s.index, edge, s.value);
    },
    [onScrub, onMove, onTrim]
  );

  return (
    <div
      ref={stripRef}
      className="relative h-14 rounded-md border bg-muted/40 touch-none select-none overflow-hidden"
      onPointerDown={(e) => beginDrag(e, 'scrub', -1)}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {displaySegments.map((seg, i) => {
        const selected = i === selectedIndex;
        return (
          <div
            key={i}
            className={cn(
              'group absolute top-1 bottom-1 rounded-sm border cursor-grab transition-colors',
              selected
                ? 'bg-primary border-primary-foreground/60 ring-2 ring-primary'
                : 'bg-primary/50 border-primary/60 hover:bg-primary/70'
            )}
            style={{
              left: `${toPct(seg.start)}%`,
              width: `${Math.max(toPct(seg.end) - toPct(seg.start), 0.5)}%`,
            }}
            title={`Segment ${i}: ${formatClipTime(seg.start)} – ${formatClipTime(seg.end)}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              beginDrag(e, 'move', i);
            }}
          >
            {/* Resize handles */}
            <div
              className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/30"
              onPointerDown={(e) => {
                e.stopPropagation();
                beginDrag(e, 'trim-start', i);
              }}
            />
            <div
              className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/30"
              onPointerDown={(e) => {
                e.stopPropagation();
                beginDrag(e, 'trim-end', i);
              }}
            />

            {/* Delete — appears on hover or when selected */}
            <button
              type="button"
              aria-label={`Delete segment ${i}`}
              className={cn(
                'absolute -top-0.5 -right-0.5 z-10 rounded-sm bg-destructive/90 p-0.5 text-white shadow-sm',
                'hover:bg-destructive focus:outline-none focus:ring-1 focus:ring-white',
                selected ? 'flex' : 'hidden group-hover:flex'
              )}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(i);
              }}
            >
              <Trash2 className="h-2.5 w-2.5" />
            </button>
          </div>
        );
      })}

      {/* Marked cut range */}
      {markIn !== null && markOut !== null && markIn < markOut && (
        <div
          className="absolute top-0 bottom-0 bg-destructive/25 border-x border-destructive pointer-events-none"
          style={{
            left: `${toPct(markIn)}%`,
            width: `${toPct(markOut) - toPct(markIn)}%`,
          }}
        />
      )}
      {markIn !== null && (
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-destructive pointer-events-none"
          style={{ left: `${toPct(markIn)}%` }}
        />
      )}
      {markOut !== null && (
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-destructive pointer-events-none"
          style={{ left: `${toPct(markOut)}%` }}
        />
      )}

      {/* Playhead */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none"
        style={{ left: `${toPct(currentTime)}%` }}
      />
    </div>
  );
}
