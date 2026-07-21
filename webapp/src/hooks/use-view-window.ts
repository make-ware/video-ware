'use client';

import { useState, useCallback, useMemo } from 'react';

export interface ViewWindow {
  /** Window start in media-source seconds. */
  from: number;
  /** Window end in media-source seconds. */
  to: number;
}

/** Smallest window span (seconds) the zoom-in button can reach. */
export const MIN_WINDOW_SPAN = 1;

const ZOOM_FACTOR = 2;
const EPSILON = 0.001;

/** Fraction of the content span padded on each side of the default window. */
const DEFAULT_PAD_RATIO = 0.15;
/** Minimum padding (seconds) so short clips still get grabbable wiggle room. */
const DEFAULT_PAD_MIN = 1;

interface UseViewWindowOptions {
  /** Total addressable time (media duration) — the zoom-out limit. */
  total: number;
  /**
   * Content range the default window frames (the clip's trim range or the
   * segment span). Only read on first render; later changes never move the
   * window — panning/zooming stays under the user's control.
   */
  contentStart: number;
  contentEnd: number;
}

/**
 * Default window: the content range plus a buffer on each side so trim
 * handles sit inside the window with wiggle room instead of pinned to its
 * edges. Content spanning (nearly) the whole media gets the full window.
 */
export function defaultViewWindow(
  total: number,
  contentStart: number,
  contentEnd: number
): ViewWindow {
  if (total <= 0) return { from: 0, to: Math.max(contentEnd, 1) };
  const span = contentEnd - contentStart;
  if (span <= 0 || span >= total - EPSILON) return { from: 0, to: total };
  const pad = Math.max(span * DEFAULT_PAD_RATIO, DEFAULT_PAD_MIN);
  return {
    from: Math.max(0, contentStart - pad),
    to: Math.min(total, contentEnd + pad),
  };
}

function clampWindow(view: ViewWindow, total: number): ViewWindow {
  if (total <= 0) return view;
  const span = Math.min(Math.max(view.to - view.from, EPSILON), total);
  const from = Math.max(0, Math.min(view.from, total - span));
  return from === view.from && from + span === view.to
    ? view
    : { from, to: from + span };
}

/**
 * A zoomable, pannable view window over `[0, total]` media seconds, shared
 * by the clip editor's trim track and the fine-tune segment strip. Zooming
 * out is gated at the full media length; zooming in at
 * {@link MIN_WINDOW_SPAN}. All updates preserve the invariant
 * `0 <= from < to <= total` and return the same reference on no-ops.
 */
export function useViewWindow({
  total,
  contentStart,
  contentEnd,
}: UseViewWindowOptions) {
  const [rawView, setRawView] = useState<ViewWindow>(() =>
    defaultViewWindow(total, contentStart, contentEnd)
  );

  // Clamp at read time so a changed `total` never needs an effect.
  const view = useMemo(() => clampWindow(rawView, total), [rawView, total]);

  const span = view.to - view.from;
  const minSpan =
    total > 0 ? Math.min(MIN_WINDOW_SPAN, total) : MIN_WINDOW_SPAN;
  const canZoomIn = span > minSpan + EPSILON;
  const canZoomOut = total > 0 && span < total - EPSILON;
  const isWindowed = canZoomOut;

  const applyZoom = useCallback(
    (factor: number) => {
      setRawView((prev) => {
        const current = clampWindow(prev, total);
        const currentSpan = current.to - current.from;
        const nextSpan = Math.min(
          Math.max(currentSpan * factor, minSpan),
          total > 0 ? total : currentSpan * factor
        );
        if (Math.abs(nextSpan - currentSpan) < EPSILON) return prev;
        const center = (current.from + current.to) / 2;
        return clampWindow(
          { from: center - nextSpan / 2, to: center + nextSpan / 2 },
          total
        );
      });
    },
    [total, minSpan]
  );

  const zoomIn = useCallback(() => applyZoom(1 / ZOOM_FACTOR), [applyZoom]);
  const zoomOut = useCallback(() => applyZoom(ZOOM_FACTOR), [applyZoom]);

  /** Pan to an absolute window start, preserving the current span. */
  const panTo = useCallback(
    (from: number) => {
      setRawView((prev) => {
        const current = clampWindow(prev, total);
        const currentSpan = current.to - current.from;
        const next = clampWindow({ from, to: from + currentSpan }, total);
        return Math.abs(next.from - current.from) < EPSILON ? prev : next;
      });
    },
    [total]
  );

  /** Minimal pan so `time` is inside the window with a small margin. */
  const reveal = useCallback(
    (time: number) => {
      setRawView((prev) => {
        const current = clampWindow(prev, total);
        const currentSpan = current.to - current.from;
        const margin = currentSpan * 0.05;
        if (time >= current.from + margin && time <= current.to - margin) {
          return prev;
        }
        const from =
          time < current.from + margin
            ? time - margin
            : time + margin - currentSpan;
        const next = clampWindow({ from, to: from + currentSpan }, total);
        return Math.abs(next.from - current.from) < EPSILON ? prev : next;
      });
    },
    [total]
  );

  return {
    view,
    span,
    isWindowed,
    canZoomIn,
    canZoomOut,
    zoomIn,
    zoomOut,
    panTo,
    reveal,
  };
}
