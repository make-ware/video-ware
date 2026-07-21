import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useViewWindow,
  defaultViewWindow,
  MIN_WINDOW_SPAN,
} from '../use-view-window';

describe('defaultViewWindow', () => {
  it('pads the content range by 15% of its span (min 1s)', () => {
    // span 10 → pad 1.5
    expect(defaultViewWindow(100, 40, 50)).toEqual({ from: 38.5, to: 51.5 });
    // span 3 → pad clamps up to 1
    expect(defaultViewWindow(100, 2, 5)).toEqual({ from: 1, to: 6 });
  });

  it('clamps the padded window to [0, total]', () => {
    expect(defaultViewWindow(100, 0, 4)).toEqual({ from: 0, to: 5 });
    expect(defaultViewWindow(100, 96, 100)).toEqual({ from: 95, to: 100 });
  });

  it('returns the full window when content spans the media', () => {
    expect(defaultViewWindow(100, 0, 100)).toEqual({ from: 0, to: 100 });
  });

  it('returns the full window for empty or inverted content', () => {
    expect(defaultViewWindow(100, 50, 50)).toEqual({ from: 0, to: 100 });
    expect(defaultViewWindow(100, 60, 50)).toEqual({ from: 0, to: 100 });
  });

  it('falls back sanely when total is unknown', () => {
    expect(defaultViewWindow(0, 0, 30)).toEqual({ from: 0, to: 30 });
    expect(defaultViewWindow(0, 0, 0)).toEqual({ from: 0, to: 1 });
  });
});

describe('useViewWindow', () => {
  const setup = (total = 100, contentStart = 40, contentEnd = 50) =>
    renderHook(() => useViewWindow({ total, contentStart, contentEnd }));

  it('initializes to the padded default window', () => {
    const { result } = setup();
    expect(result.current.view).toEqual({ from: 38.5, to: 51.5 });
    expect(result.current.isWindowed).toBe(true);
    expect(result.current.canZoomIn).toBe(true);
    expect(result.current.canZoomOut).toBe(true);
  });

  it('zoomOut doubles the span around the center, gated at the media length', () => {
    const { result } = setup();
    act(() => result.current.zoomOut());
    // span 13 → 26, center 45
    expect(result.current.view.from).toBeCloseTo(32, 5);
    expect(result.current.view.to).toBeCloseTo(58, 5);

    act(() => result.current.zoomOut());
    act(() => result.current.zoomOut());
    act(() => result.current.zoomOut());
    expect(result.current.view).toEqual({ from: 0, to: 100 });
    expect(result.current.canZoomOut).toBe(false);

    // Gated: zooming out at full media is a no-op
    const before = result.current.view;
    act(() => result.current.zoomOut());
    expect(result.current.view).toBe(before);
  });

  it('zoomIn halves the span around the center down to MIN_WINDOW_SPAN', () => {
    const { result } = setup();
    act(() => result.current.zoomIn());
    // span 13 → 6.5, center 45
    expect(result.current.view.from).toBeCloseTo(41.75, 5);
    expect(result.current.view.to).toBeCloseTo(48.25, 5);

    for (let i = 0; i < 10; i++) {
      act(() => result.current.zoomIn());
    }
    expect(result.current.span).toBeCloseTo(MIN_WINDOW_SPAN, 5);
    expect(result.current.canZoomIn).toBe(false);
  });

  it('clamps zoomOut within [0, total] near an edge', () => {
    const { result } = setup(100, 0, 4); // window [0, 5]
    act(() => result.current.zoomOut());
    expect(result.current.view).toEqual({ from: 0, to: 10 });
  });

  it('panTo preserves the span and clamps to the media bounds', () => {
    const { result } = setup(); // span 13
    act(() => result.current.panTo(60));
    expect(result.current.view).toEqual({ from: 60, to: 73 });
    act(() => result.current.panTo(95));
    expect(result.current.view).toEqual({ from: 87, to: 100 });
    act(() => result.current.panTo(-5));
    expect(result.current.view).toEqual({ from: 0, to: 13 });
  });

  it('reveal pans minimally to include an out-of-window time', () => {
    const { result } = setup(); // [38.5, 51.5], margin 0.65
    act(() => result.current.reveal(60));
    expect(result.current.view.to).toBeCloseTo(60.65, 5);
    expect(result.current.span).toBeCloseTo(13, 5);

    act(() => result.current.reveal(10));
    expect(result.current.view.from).toBeCloseTo(9.35, 5);
    expect(result.current.span).toBeCloseTo(13, 5);
  });

  it('reveal is a referential no-op for a time already in view', () => {
    const { result } = setup();
    const before = result.current.view;
    act(() => result.current.reveal(45));
    expect(result.current.view).toBe(before);
  });

  it('never zooms in below the media length when the media is very short', () => {
    const { result } = setup(0.8, 0, 0.5);
    act(() => result.current.zoomIn());
    expect(result.current.span).toBeLessThanOrEqual(0.8);
    expect(result.current.canZoomIn).toBe(false);
  });
});
