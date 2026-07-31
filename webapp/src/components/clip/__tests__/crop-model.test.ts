import { describe, it, expect } from 'vitest';
import {
  cropStateFromRect,
  deriveCropRect,
  describeCrop,
  presetAspect,
} from '../crop-model';

const LANDSCAPE = 16 / 9;

describe('deriveCropRect', () => {
  it('derives the largest centered window for a preset at zoom 1', () => {
    const rect = deriveCropRect({
      mediaAspect: LANDSCAPE,
      aspect: presetAspect('9:16', LANDSCAPE),
      zoom: 1,
      center: { x: 0.5, y: 0.5 },
    });
    // 9:16 over 16:9: width = (9/16)/(16/9) = 81/256 ≈ 0.3164, full height.
    expect(rect.width).toBeCloseTo(81 / 256, 3);
    expect(rect.height).toBe(1);
    expect(rect.left).toBeCloseTo((1 - 81 / 256) / 2, 3);
    expect(rect.top).toBe(0);
  });

  it('halves both sides at zoom 2 and clamps an off-center pan inside', () => {
    const rect = deriveCropRect({
      mediaAspect: LANDSCAPE,
      aspect: LANDSCAPE,
      zoom: 2,
      center: { x: 1, y: 0 }, // far corner: clamp, don't escape
    });
    expect(rect.width).toBeCloseTo(0.5, 4);
    expect(rect.height).toBeCloseTo(0.5, 4);
    expect(rect.left).toBeCloseTo(0.5, 4);
    expect(rect.top).toBe(0);
  });

  it('clamps zoom into [1, 8]', () => {
    const zoomedOut = deriveCropRect({
      mediaAspect: LANDSCAPE,
      aspect: LANDSCAPE,
      zoom: 0.1,
      center: { x: 0.5, y: 0.5 },
    });
    expect(zoomedOut.width).toBe(1);
    const zoomedIn = deriveCropRect({
      mediaAspect: LANDSCAPE,
      aspect: LANDSCAPE,
      zoom: 100,
      center: { x: 0.5, y: 0.5 },
    });
    expect(zoomedIn.width).toBeCloseTo(1 / 8, 3);
  });
});

describe('cropStateFromRect', () => {
  it('round-trips derive → classify within tolerance', () => {
    const rect = deriveCropRect({
      mediaAspect: LANDSCAPE,
      aspect: presetAspect('1:1', LANDSCAPE),
      zoom: 1.5,
      center: { x: 0.4, y: 0.6 },
    });
    const state = cropStateFromRect(rect, LANDSCAPE);
    expect(state.preset).toBe('1:1');
    expect(state.zoom).toBeCloseTo(1.5, 2);
    expect(state.center.x).toBeCloseTo(0.4, 2);
    expect(state.center.y).toBeCloseTo(0.6, 2);
  });

  it('classifies a full-frame-aspect rect as original and odd rects as null', () => {
    expect(
      cropStateFromRect(
        { left: 0.25, top: 0.25, width: 0.5, height: 0.5 },
        LANDSCAPE
      ).preset
    ).toBe('original');
    expect(
      cropStateFromRect(
        { left: 0, top: 0, width: 0.9, height: 0.37 },
        LANDSCAPE
      ).preset
    ).toBe(null);
  });
});

describe('describeCrop', () => {
  it('labels rects by nearest preset, Original, or Custom', () => {
    expect(
      describeCrop(
        { left: 0.3418, top: 0, width: 81 / 256, height: 1 },
        LANDSCAPE
      )
    ).toBe('9:16');
    expect(
      describeCrop(
        { left: 0.25, top: 0.25, width: 0.5, height: 0.5 },
        LANDSCAPE
      )
    ).toBe('Original');
    expect(
      describeCrop({ left: 0, top: 0, width: 0.9, height: 0.37 }, LANDSCAPE)
    ).toBe('Custom');
    expect(describeCrop(null, LANDSCAPE)).toBe('Custom');
  });
});
