import { describe, it, expect } from 'vitest';
import {
  cropRectToPixels,
  isFullFrameCrop,
  resolveCropRect,
  sanitizeCropRect,
} from '../crop';
import { CropRectSchema, type CropRect } from '../../types/crop';
import { TimelineMetadataSchema } from '../../types/metadata';
import type { TimelineTrack } from '../../types/task-contracts';

const rect = (
  left: number,
  top: number,
  width: number,
  height: number
): CropRect => ({ left, top, width, height });

describe('sanitizeCropRect', () => {
  it('accepts a valid rect unchanged', () => {
    expect(sanitizeCropRect(rect(0.1, 0.2, 0.5, 0.6))).toEqual(
      rect(0.1, 0.2, 0.5, 0.6)
    );
  });

  it('rejects null, non-objects and missing/non-finite members', () => {
    expect(sanitizeCropRect(null)).toBeUndefined();
    expect(sanitizeCropRect(undefined)).toBeUndefined();
    expect(sanitizeCropRect('0.1,0,0.5,1')).toBeUndefined();
    expect(sanitizeCropRect({ left: 0, top: 0, width: 0.5 })).toBeUndefined();
    expect(sanitizeCropRect(rect(NaN, 0, 0.5, 0.5))).toBeUndefined();
    expect(sanitizeCropRect(rect(0, Infinity, 0.5, 0.5))).toBeUndefined();
  });

  it('clamps out-of-bounds values into the frame', () => {
    // Oversized width shrinks to fit left + width <= 1.
    expect(sanitizeCropRect(rect(0.5, 0, 0.9, 1))).toEqual(
      rect(0.5, 0, 0.5, 1)
    );
    expect(sanitizeCropRect(rect(-0.2, 0, 0.5, 1))).toEqual(rect(0, 0, 0.5, 1));
  });

  it('rejects degenerate rects (a side below the minimum after clamping)', () => {
    expect(sanitizeCropRect(rect(0, 0, 0.001, 1))).toBeUndefined();
    // left pins the window to the right edge, leaving no width.
    expect(sanitizeCropRect(rect(1, 0, 0.5, 1))).toBeUndefined();
  });
});

describe('isFullFrameCrop', () => {
  it('detects the full frame within tolerance', () => {
    expect(isFullFrameCrop(rect(0, 0, 1, 1))).toBe(true);
    expect(isFullFrameCrop(rect(0.0005, 0.0005, 0.9995, 0.9995))).toBe(true);
    expect(isFullFrameCrop(rect(0, 0, 0.95, 1))).toBe(false);
  });
});

describe('resolveCropRect', () => {
  const mediaCrop = rect(0, 0.12, 1, 0.76); // strip letterbox bars
  const clipCrop = rect(0.3, 0, 0.4, 1); // 9:16-ish reframe

  it('resolves clip crop over media crop over nothing', () => {
    expect(resolveCropRect({ crop: mediaCrop }, { crop: clipCrop })).toEqual(
      clipCrop
    );
    expect(resolveCropRect({ crop: mediaCrop }, {})).toEqual(mediaCrop);
    expect(resolveCropRect({ crop: mediaCrop }, undefined)).toEqual(mediaCrop);
    expect(resolveCropRect({}, {})).toBeUndefined();
    expect(resolveCropRect(null, null)).toBeUndefined();
    expect(resolveCropRect({ crop: null }, { crop: null })).toBeUndefined();
  });

  it('treats an explicit full-frame clip rect as "no crop" WITHOUT falling back', () => {
    // This is how a placement opts back into the full original frame over a
    // media default — reset-to-default is deleting the key instead.
    expect(
      resolveCropRect({ crop: mediaCrop }, { crop: rect(0, 0, 1, 1) })
    ).toBeUndefined();
  });

  it('falls back to the media crop when the clip rect is malformed', () => {
    expect(
      resolveCropRect(
        { crop: mediaCrop },
        { crop: { left: 0, top: 0 } as CropRect }
      )
    ).toEqual(mediaCrop);
  });

  it('resolves a ~full-frame media crop to undefined', () => {
    expect(
      resolveCropRect({ crop: rect(0, 0.0005, 1, 0.999) }, {})
    ).toBeUndefined();
  });
});

describe('cropRectToPixels', () => {
  it('converts fractions to even pixels in crop=w:h:x:y order', () => {
    expect(cropRectToPixels(rect(0.25, 0, 0.5, 1), 1920, 1080)).toEqual({
      x: 480,
      y: 0,
      width: 960,
      height: 1080,
    });
  });

  it('works from rotation-swapped display dimensions', () => {
    // A 90°-rotated 1920x1080 source displays as 1080x1920.
    expect(cropRectToPixels(rect(0.25, 0, 0.5, 1), 1080, 1920)).toEqual({
      x: 270,
      y: 0,
      width: 540,
      height: 1920,
    });
  });

  it('even-rounds and keeps the window inside the frame', () => {
    // 0.333 * 1280 = 426.24 -> 426; 0.5 * 720 = 360.
    expect(cropRectToPixels(rect(0.333, 0.5, 0.333, 0.5), 1280, 720)).toEqual({
      x: 426,
      y: 360,
      width: 426,
      height: 360,
    });
    // Right-edge rect: x clamps so x + width never exceeds the frame.
    const px = cropRectToPixels(rect(0.999, 0, 0.001, 1), 1920, 1080);
    expect(px).toBeDefined();
    expect(px!.x + px!.width).toBeLessThanOrEqual(1920);
    expect(px!.width).toBeGreaterThanOrEqual(2);
  });

  it('never escapes an odd-dimensioned frame and stays even', () => {
    const px = cropRectToPixels(rect(0, 0, 1, 1), 1919, 1079)!;
    expect(px.x + px.width).toBeLessThanOrEqual(1919);
    expect(px.y + px.height).toBeLessThanOrEqual(1079);
    for (const v of [px.x, px.y, px.width, px.height]) {
      expect(v % 2).toBe(0);
    }
  });

  it('returns undefined for unknown display dimensions', () => {
    expect(cropRectToPixels(rect(0, 0, 1, 1), 0, 1080)).toBeUndefined();
    expect(cropRectToPixels(rect(0, 0, 1, 1), 1920, 0)).toBeUndefined();
    expect(cropRectToPixels(rect(0, 0, 1, 1), NaN, 1080)).toBeUndefined();
  });
});

describe('CropRectSchema', () => {
  it('rejects rects that extend past the frame', () => {
    expect(CropRectSchema.safeParse(rect(0.6, 0, 0.6, 1)).success).toBe(false);
    expect(CropRectSchema.safeParse(rect(0, 0.6, 1, 0.6)).success).toBe(false);
    expect(CropRectSchema.safeParse(rect(0.1, 0.1, 0.8, 0.8)).success).toBe(
      true
    );
  });
});

describe('TimelineMetadataSchema crop round-trip', () => {
  it('preserves video.crop through the timelineData validation gate', () => {
    // TimelineRenders.timelineData is parsed on create and undeclared keys
    // are silently stripped — this pins that the crop survives.
    const tracks: TimelineTrack[] = [
      {
        id: 'track-1',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 'seg-1',
            assetId: 'media-1',
            type: 'video',
            time: { start: 0, duration: 5, sourceStart: 1 },
            video: { opacity: 1, crop: rect(0.25, 0, 0.5, 1) },
          },
        ],
      },
    ];
    const parsed = TimelineMetadataSchema.parse(tracks);
    expect(parsed[0].segments[0].video?.crop).toEqual(rect(0.25, 0, 0.5, 1));
  });
});
