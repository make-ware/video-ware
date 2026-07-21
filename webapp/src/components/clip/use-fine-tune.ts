'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  cutSegments,
  deleteSegment,
  deriveClipTimes,
  normalizeSegments,
  slipSegments,
  splitSegments,
  trimSegment,
} from '@project/shared';
import type { Segment } from '@/components/timeline/segment-editor';

/**
 * Derived clip times, tolerating an empty list. An empty list only occurs
 * when the *initial* window is degenerate (normalize dropped it) — ops
 * themselves can never empty the list.
 */
function safeTimes(list: Segment[]) {
  return list.length > 0
    ? deriveClipTimes(list)
    : { start: 0, end: 0, duration: 0 };
}

interface UseFineTuneOptions {
  /** The edit list to fine-tune; a single trim-window segment when the clip
   * isn't composite yet (the first applied edit converts it). */
  initialSegments: Segment[];
  mediaDuration: number;
  /** Images/legacy media have no upper time bound (validateTimeRange rule). */
  isImage?: boolean;
}

/**
 * Local segment-edit state for the fine-tune modal, wrapping the shared
 * split/cut/trim/slip pure functions (the same ops the `vw` CLI exposes).
 *
 * Every successful op pushes onto an undo history; failed ops surface the
 * shared functions' error messages via `error` and change nothing. Nothing is
 * persisted here — the caller applies `segments` on save.
 */
export function useFineTune({
  initialSegments,
  mediaDuration,
  isImage = false,
}: UseFineTuneOptions) {
  const bounds = useMemo(
    () => (isImage ? {} : { mediaDuration }),
    [isImage, mediaDuration]
  );

  // history[historyIndex] is the current edit list; entries after the index
  // are redo states. The initial entry is the normalized starting list.
  const [history, setHistory] = useState<Segment[][]>(() => [
    normalizeSegments(initialSegments, isImage ? {} : { mediaDuration }),
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const segments = history[historyIndex];

  const applyOp = useCallback(
    (op: (current: Segment[]) => Segment[]): boolean => {
      try {
        const next = op(segments);
        setHistory((prev) => [...prev.slice(0, historyIndex + 1), next]);
        setHistoryIndex(historyIndex + 1);
        // Indices shift when segments split/merge/vanish — clamping keeps the
        // selection valid, even if it lands on a neighbor.
        setSelectedIndex((sel) =>
          sel === null ? null : Math.min(sel, next.length - 1)
        );
        setError(null);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Edit failed');
        return false;
      }
    },
    [segments, historyIndex]
  );

  const split = useCallback(
    (at: number) => applyOp((s) => splitSegments(s, [at], bounds)),
    [applyOp, bounds]
  );

  const cut = useCallback(
    (from: number, to: number) =>
      applyOp((s) => cutSegments(s, from, to, bounds)),
    [applyOp, bounds]
  );

  const trim = useCallback(
    (index: number, patch: { start?: number; end?: number }) =>
      applyOp((s) => trimSegment(s, index, patch, bounds)),
    [applyOp, bounds]
  );

  /** Remove one segment by index; fails (surfacing an error) on the last one. */
  const remove = useCallback(
    (index: number) => applyOp((s) => deleteSegment(s, index, bounds)),
    [applyOp, bounds]
  );

  /**
   * Merge the whole edit list into its single spanning segment — "remove all
   * cuts". Undoable like any op; on save the 1-segment list collapses
   * (finalizeSegments), reverting the clip to a plain start/end trim.
   */
  const mergeAll = useCallback(
    () =>
      applyOp((s) => {
        if (s.length < 2) {
          throw new Error(
            'No cuts to remove — the clip already plays straight through.'
          );
        }
        return [
          {
            start: Math.min(...s.map((seg) => seg.start)),
            end: Math.max(...s.map((seg) => seg.end)),
          },
        ];
      }),
    [applyOp]
  );

  /**
   * Slip the whole edit list (index null) or one segment by ±seconds.
   * Returns the clamped delta actually applied (compare with `by` to detect
   * clamping), or null when nothing could move / the op failed — no history
   * entry is created in that case.
   */
  const slip = useCallback(
    (by: number, index: number | null): number | null => {
      let applied = 0;
      const ok = applyOp((s) => {
        const result = slipSegments(s, by, {
          ...(index !== null ? { index } : {}),
          ...bounds,
        });
        applied = result.applied;
        if (result.applied === 0) {
          throw new Error(
            'Nothing to slip — the content is already flush against its bounds.'
          );
        }
        return result.segments;
      });
      return ok ? applied : null;
    },
    [applyOp, bounds]
  );

  const undo = useCallback(() => {
    setHistoryIndex((i) => Math.max(0, i - 1));
    setSelectedIndex(null);
    setError(null);
  }, []);

  const redo = useCallback(() => {
    setHistoryIndex((i) => Math.min(history.length - 1, i + 1));
    setSelectedIndex(null);
    setError(null);
  }, [history.length]);

  const reset = useCallback(() => {
    setHistoryIndex(0);
    setHistory((prev) => [prev[0]]);
    setSelectedIndex(null);
    setError(null);
  }, []);

  const times = useMemo(() => safeTimes(segments), [segments]);
  const initialTimes = useMemo(() => safeTimes(history[0]), [history]);

  return {
    segments,
    times,
    initialTimes,
    selectedIndex,
    setSelectedIndex,
    error,
    clearError: useCallback(() => setError(null), []),
    split,
    cut,
    trim,
    remove,
    mergeAll,
    slip,
    undo,
    redo,
    reset,
    canUndo: historyIndex > 0,
    canRedo: historyIndex < history.length - 1,
    hasChanges: historyIndex > 0,
  };
}
