import { describe, it, expect } from 'vitest';
import {
  evenTileHeight,
  mediaDisplayAspect,
  mediaDisplayDimensions,
  normalizeRotation,
  rotationSwapsAxes,
} from '../media-dimensions';

describe('mediaDisplayDimensions', () => {
  it('prefers the probe display dimensions', () => {
    // A portrait phone clip: coded landscape, 90° display matrix.
    expect(
      mediaDisplayDimensions({
        width: 1920,
        height: 1080,
        mediaData: {
          width: 1920,
          height: 1080,
          displayWidth: 1080,
          displayHeight: 1920,
          rotation: 90,
        },
      })
    ).toEqual({ width: 1080, height: 1920, aspect: 1080 / 1920 });
  });

  it('swaps the coded pair when only a rotation is known', () => {
    expect(
      mediaDisplayDimensions({ width: 1920, height: 1080, rotation: 270 })
    ).toEqual({ width: 1080, height: 1920, aspect: 1080 / 1920 });
  });

  it('reads rotation from the probe video block when the row lacks it', () => {
    expect(
      mediaDisplayDimensions({
        width: 1920,
        height: 1080,
        mediaData: { video: { rotation: 90 } },
      }).aspect
    ).toBeCloseTo(1080 / 1920);
  });

  it('leaves 180° rotations unswapped', () => {
    expect(
      mediaDisplayDimensions({ width: 1920, height: 1080, rotation: 180 })
    ).toEqual({ width: 1920, height: 1080, aspect: 1920 / 1080 });
  });

  it('passes through non-16:9 media unrotated', () => {
    expect(mediaDisplayDimensions({ width: 1080, height: 1080 })).toEqual({
      width: 1080,
      height: 1080,
      aspect: 1,
    });
  });

  it('reports unknown (zero) dimensions for audio-only media', () => {
    expect(
      mediaDisplayDimensions({
        width: 0,
        height: 0,
        mediaData: { displayWidth: 0, displayHeight: 0 },
      })
    ).toEqual({ width: 0, height: 0, aspect: 0 });
  });

  it('tolerates a missing/garbage source', () => {
    expect(mediaDisplayDimensions(null)).toEqual({
      width: 0,
      height: 0,
      aspect: 0,
    });
    expect(
      mediaDisplayDimensions({ width: Number.NaN, height: -10 }).aspect
    ).toBe(0);
  });

  it('falls back to the probe coded pair when the row has none', () => {
    expect(
      mediaDisplayDimensions({ mediaData: { width: 640, height: 480 } })
    ).toEqual({ width: 640, height: 480, aspect: 640 / 480 });
  });
});

describe('mediaDisplayAspect', () => {
  it('substitutes the fallback only when dimensions are unknown', () => {
    expect(mediaDisplayAspect({ width: 1080, height: 1920 })).toBeCloseTo(
      0.5625
    );
    expect(mediaDisplayAspect(null)).toBeCloseTo(16 / 9);
    expect(mediaDisplayAspect(null, 1)).toBe(1);
  });
});

describe('normalizeRotation / rotationSwapsAxes', () => {
  it('normalizes into [0, 360)', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(undefined)).toBe(0);
    expect(normalizeRotation(Number.NaN)).toBe(0);
  });

  it('swaps axes only on the quarter turns', () => {
    expect(rotationSwapsAxes(90)).toBe(true);
    expect(rotationSwapsAxes(-90)).toBe(true);
    expect(rotationSwapsAxes(180)).toBe(false);
    expect(rotationSwapsAxes(0)).toBe(false);
  });
});

describe('evenTileHeight', () => {
  it('keeps the tile at the given aspect, rounded to an even height', () => {
    expect(evenTileHeight(320, 16 / 9)).toBe(180);
    expect(evenTileHeight(320, 1080 / 1920)).toBe(570); // 568.88 -> even
    expect(evenTileHeight(320, 1)).toBe(320);
    expect(evenTileHeight(160, 4 / 3)).toBe(120);
  });

  it('never returns an odd or zero height for a real aspect', () => {
    for (const aspect of [0.4, 0.5625, 1, 1.3333, 1.7778, 2.39, 12]) {
      const height = evenTileHeight(320, aspect);
      expect(height % 2).toBe(0);
      expect(height).toBeGreaterThan(0);
    }
  });

  it('returns 0 when the inputs cannot describe a tile', () => {
    expect(evenTileHeight(0, 16 / 9)).toBe(0);
    expect(evenTileHeight(320, 0)).toBe(0);
    expect(evenTileHeight(320, Number.NaN)).toBe(0);
    expect(evenTileHeight(320, Number.POSITIVE_INFINITY)).toBe(0);
  });
});
