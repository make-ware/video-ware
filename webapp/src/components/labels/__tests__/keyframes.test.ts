import { describe, it, expect } from 'vitest';
import type { LabelTrack } from '@project/shared';
import {
  bboxCropRegion,
  cropBackground,
  interpolateBbox,
  normalizeKeyframes,
  tileFrameTime,
  tileIndexFor,
  type Keyframe,
  type TileGeometry,
} from '../keyframes';

function kf(t: number, bbox: Partial<Keyframe['bbox']> = {}): Keyframe {
  return {
    t,
    bbox: { left: 0.1, top: 0.1, right: 0.3, bottom: 0.3, ...bbox },
    confidence: 0.9,
  };
}

const asRaw = (frames: unknown): LabelTrack['keyframes'] =>
  frames as LabelTrack['keyframes'];

describe('normalizeKeyframes', () => {
  it('converts absolute times to track-relative and sorts', () => {
    const result = normalizeKeyframes(asRaw([kf(12), kf(10), kf(11)]), 10);
    expect(result.map((k) => k.t)).toEqual([0, 1, 2]);
  });

  it('drops malformed entries', () => {
    const result = normalizeKeyframes(
      asRaw([
        kf(10),
        null,
        { t: 11 }, // no bbox
        { t: '12', bbox: kf(0).bbox }, // non-numeric time
        { t: 13, bbox: { left: 0.1, top: 0.1, right: 0.3 } }, // missing bottom
      ]),
      10
    );
    expect(result).toHaveLength(1);
    expect(result[0].t).toBe(0);
  });

  it('returns [] for non-array input', () => {
    expect(normalizeKeyframes(asRaw(undefined), 0)).toEqual([]);
    expect(normalizeKeyframes(asRaw({ not: 'an array' }), 0)).toEqual([]);
  });
});

describe('interpolateBbox', () => {
  const sorted = [
    kf(0, { left: 0.0, top: 0.0, right: 0.2, bottom: 0.2 }),
    kf(2, { left: 0.4, top: 0.4, right: 0.6, bottom: 0.6 }),
  ];

  it('returns null for empty keyframes', () => {
    expect(interpolateBbox([], 1)).toBeNull();
  });

  it('holds the first box before the first keyframe', () => {
    expect(interpolateBbox(sorted, -1)).toEqual(sorted[0].bbox);
  });

  it('holds the last box after the last keyframe', () => {
    expect(interpolateBbox(sorted, 99)).toEqual(sorted[1].bbox);
  });

  it('linearly interpolates between keyframes', () => {
    const box = interpolateBbox(sorted, 1);
    expect(box).toEqual({ left: 0.2, top: 0.2, right: 0.4, bottom: 0.4 });
  });

  it('falls back to the previous keyframe when times coincide', () => {
    const dup = [kf(1, { left: 0 }), kf(1, { left: 0.5 })];
    expect(interpolateBbox(dup, 1)).toEqual(dup[1].bbox);
  });

  it('falls back to the previous keyframe on degenerate interpolation', () => {
    const degenerate = [
      kf(0, { left: 0.1, right: 0.3 }),
      kf(2, { left: 0.3, right: 0.1 }), // inverted box
    ];
    // At t=1 both boxes average to a zero-width box (right === left).
    expect(interpolateBbox(degenerate, 1)).toEqual(degenerate[0].bbox);
  });
});

describe('bboxCropRegion', () => {
  it('produces a display-square region around the bbox center', () => {
    const region = bboxCropRegion(
      { left: 0.4, top: 0.3, right: 0.5, bottom: 0.6 },
      16 / 9,
      1,
      0
    );
    expect(region).not.toBeNull();
    // Display-square: width * aspect === height.
    expect(region!.width * (16 / 9)).toBeCloseTo(region!.height, 10);
    // Height dominated (0.3 > 0.1 * 16/9) and centered on the bbox.
    expect(region!.height).toBeCloseTo(0.3, 10);
    expect(region!.top).toBeCloseTo(0.3, 10);
    expect(region!.left + region!.width / 2).toBeCloseTo(0.45, 10);
  });

  it('matches a non-square display aspect without distortion', () => {
    const region = bboxCropRegion(
      { left: 0.4, top: 0.3, right: 0.5, bottom: 0.6 },
      16 / 9,
      16 / 9,
      0
    );
    expect(region).not.toBeNull();
    // Display aspect: (width * frameAspect) / height === target.
    expect((region!.width * (16 / 9)) / region!.height).toBeCloseTo(16 / 9, 10);
    // Height still dominated by the bbox and centered on it.
    expect(region!.height).toBeCloseTo(0.3, 10);
    expect(region!.left + region!.width / 2).toBeCloseTo(0.45, 10);
  });

  it('pads the region by the given fraction', () => {
    const noPad = bboxCropRegion(
      { left: 0.4, top: 0.4, right: 0.6, bottom: 0.6 },
      1,
      1,
      0
    );
    const padded = bboxCropRegion(
      { left: 0.4, top: 0.4, right: 0.6, bottom: 0.6 },
      1,
      1,
      0.25
    );
    expect(padded!.height).toBeCloseTo(noPad!.height * 1.5, 10);
  });

  it('clamps to the frame at edges', () => {
    const region = bboxCropRegion(
      { left: 0.0, top: 0.0, right: 0.1, bottom: 0.4 },
      16 / 9,
      1,
      0
    );
    expect(region!.left).toBeGreaterThanOrEqual(0);
    expect(region!.top).toBeGreaterThanOrEqual(0);
    expect(region!.left + region!.width).toBeLessThanOrEqual(1);
    expect(region!.top + region!.height).toBeLessThanOrEqual(1);
  });

  it('caps oversized regions at the full frame', () => {
    const region = bboxCropRegion(
      { left: 0, top: 0, right: 1, bottom: 1 },
      16 / 9,
      1,
      0.25
    );
    expect(region!.width).toBe(1);
    expect(region!.height).toBe(1);
    expect(region!.left).toBe(0);
    expect(region!.top).toBe(0);
  });

  it('returns null for degenerate boxes', () => {
    expect(
      bboxCropRegion({ left: 0.5, top: 0.2, right: 0.5, bottom: 0.4 }, 1)
    ).toBeNull();
    expect(
      bboxCropRegion({ left: 0.6, top: 0.2, right: 0.4, bottom: 0.4 }, 1)
    ).toBeNull();
  });
});

describe('tile math', () => {
  const config: TileGeometry = { cols: 10, rows: 10, fps: 1, startTime: 100 };

  it('locates the tile FilmstripViewer would show', () => {
    expect(tileIndexFor(config, 100)).toBe(0);
    expect(tileIndexFor(config, 112.9)).toBe(12);
    expect(tileIndexFor(config, 99)).toBe(0); // before segment: clamp
    expect(tileIndexFor(config, 500)).toBe(99); // past segment: clamp
  });

  it('reports the captured frame timestamp for a tile', () => {
    expect(tileFrameTime(config, 112.9)).toBe(112);
  });

  describe('cropBackground', () => {
    it('reproduces the full-tile FilmstripViewer math for region {0,0,1,1}', () => {
      const full = { left: 0, top: 0, width: 1, height: 1 };
      const style = cropBackground(config, 112, full);
      expect(style.backgroundSize).toBe('1000% 1000%');
      // Tile 12 → col 2, row 1; viewer formula col/(cols-1)*100.
      const [posX, posY] = style.backgroundPosition
        .split(' ')
        .map((v) => parseFloat(v));
      expect(posX).toBeCloseTo((2 / 9) * 100, 6);
      expect(posY).toBeCloseTo((1 / 9) * 100, 6);
    });

    it('zooms into a sub-region of the tile', () => {
      const region = { left: 0.25, top: 0.5, width: 0.5, height: 0.25 };
      const style = cropBackground(config, 100, region); // tile 0
      expect(style.backgroundSize).toBe('2000% 4000%');
      const [posX, posY] = style.backgroundPosition
        .split(' ')
        .map((v) => parseFloat(v));
      // (col + left) / (cols - width) * 100
      expect(posX).toBeCloseTo((0.25 / 9.5) * 100, 6);
      expect(posY).toBeCloseTo((0.5 / 9.75) * 100, 6);
    });

    it('guards the degenerate single-tile full-width case', () => {
      const one: TileGeometry = { cols: 1, rows: 1, fps: 1, startTime: 0 };
      const style = cropBackground(one, 0, {
        left: 0,
        top: 0,
        width: 1,
        height: 1,
      });
      expect(style.backgroundPosition).toBe('0% 0%');
    });
  });
});
