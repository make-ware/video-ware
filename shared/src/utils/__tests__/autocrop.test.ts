import { describe, it, expect } from 'vitest';
import {
  autoCropOwnsCrop,
  cropBoxAgreement,
  cropBoxTolerance,
  cropBoxToRect,
  cropRectsEqual,
  decideAutoCrop,
  unionCropBoxes,
  usableCropBoxes,
  type CropBox,
} from '../autocrop';
import { FULL_FRAME_CROP, type CropSuggestion } from '../../types/crop';

const suggestion = (
  over: Partial<CropSuggestion> & Pick<CropSuggestion, 'rect'>
): CropSuggestion => ({
  pixels: { x: 0, y: 0, width: 1920, height: 1080 },
  displayWidth: 1920,
  displayHeight: 1080,
  samples: 5,
  attempted: 5,
  agreement: 1,
  applied: true,
  limit: 24,
  detectedAt: '2026-07-30T00:00:00.000Z',
  ...over,
});

describe('unionCropBoxes', () => {
  it('returns the smallest box containing every sample', () => {
    const boxes: CropBox[] = [
      { x: 0, y: 140, width: 1920, height: 800 },
      { x: 10, y: 120, width: 1900, height: 840 },
      { x: 0, y: 140, width: 1910, height: 800 },
    ];
    expect(unionCropBoxes(boxes)).toEqual({
      x: 0,
      y: 120,
      width: 1920,
      height: 840,
    });
  });

  it('drops all-black samples rather than letting them widen the union', () => {
    // cropdetect emits a non-positive box when a window has no lit content.
    const boxes: CropBox[] = [
      { x: -1, y: -1, width: -1, height: -1 },
      { x: 0, y: 140, width: 1920, height: 800 },
    ];
    expect(unionCropBoxes(boxes)).toEqual({
      x: 0,
      y: 140,
      width: 1920,
      height: 800,
    });
  });

  it('returns undefined when nothing was usable', () => {
    expect(unionCropBoxes([])).toBeUndefined();
    expect(
      unionCropBoxes([{ x: 0, y: 0, width: 0, height: 0 }])
    ).toBeUndefined();
  });

  it('never tightens past a sample — the union is a superset', () => {
    const wide = { x: 0, y: 0, width: 1920, height: 1080 };
    const narrow = { x: 200, y: 200, width: 100, height: 100 };
    const union = unionCropBoxes([narrow, wide])!;
    expect(union).toEqual(wide);
  });
});

describe('usableCropBoxes', () => {
  it('keeps only boxes that actually bound content', () => {
    const good = { x: 0, y: 140, width: 1920, height: 800 };
    expect(
      usableCropBoxes([
        good,
        { x: -1, y: -1, width: -1, height: -1 }, // all-black window
        { x: 0, y: 0, width: 0, height: 100 }, // zero side
        { x: 0, y: 0, width: Number.NaN, height: 100 },
      ])
    ).toEqual([good]);
  });
});

describe('cropBoxToRect', () => {
  it('normalizes a letterbox window against the display frame', () => {
    expect(
      cropBoxToRect({ x: 0, y: 140, width: 1920, height: 800 }, 1920, 1080)
    ).toEqual({
      left: 0,
      top: 140 / 1080,
      width: 1,
      height: 800 / 1080,
    });
  });

  it('returns undefined for unknown display dimensions', () => {
    expect(
      cropBoxToRect({ x: 0, y: 0, width: 100, height: 100 }, 0, 0)
    ).toBeUndefined();
  });

  it('returns undefined for a degenerate box', () => {
    expect(
      cropBoxToRect({ x: 0, y: 0, width: 4, height: 4 }, 1920, 1080)
    ).toBeUndefined();
  });
});

describe('cropBoxAgreement', () => {
  it('counts samples matching the union within tolerance', () => {
    const union = { x: 0, y: 120, width: 1920, height: 840 };
    const boxes: CropBox[] = [
      { x: 0, y: 120, width: 1920, height: 840 },
      { x: 0, y: 122, width: 1920, height: 838 }, // within a 10px tolerance
      { x: 0, y: 400, width: 1920, height: 280 }, // nowhere near
    ];
    expect(cropBoxAgreement(boxes, union, 10)).toBeCloseTo(2 / 3);
  });

  it('is 0 with no samples', () => {
    expect(cropBoxAgreement([], { x: 0, y: 0, width: 10, height: 10 }, 2)).toBe(
      0
    );
  });

  it('scales tolerance with the frame but never below 2px', () => {
    expect(cropBoxTolerance(1920, 1080)).toBe(11);
    expect(cropBoxTolerance(160, 90)).toBe(2);
  });
});

describe('decideAutoCrop', () => {
  const letterbox = { left: 0, top: 0.13, width: 1, height: 0.74 };

  it('applies a real letterbox crop to media with no crop', () => {
    expect(decideAutoCrop({ rect: letterbox })).toEqual({
      crop: letterbox,
      applied: true,
    });
  });

  it('does not apply a full-frame detection', () => {
    expect(decideAutoCrop({ rect: FULL_FRAME_CROP })).toEqual({
      crop: undefined,
      applied: false,
      skipReason: 'full-frame',
    });
  });

  it('ignores a trim too small to be a real border', () => {
    const noise = { left: 0, top: 0.002, width: 1, height: 0.996 };
    expect(decideAutoCrop({ rect: noise })).toEqual({
      crop: undefined,
      applied: false,
      skipReason: 'below-threshold',
    });
  });

  it('rejects an implausibly small box (a mostly dark shot)', () => {
    const tiny = { left: 0.4, top: 0.4, width: 0.2, height: 0.2 };
    expect(decideAutoCrop({ rect: tiny })).toEqual({
      applied: false,
      skipReason: 'unreliable',
    });
  });

  it("never overwrites a human's crop", () => {
    const manual = { left: 0.1, top: 0.1, width: 0.5, height: 0.5 };
    expect(decideAutoCrop({ rect: letterbox, existingCrop: manual })).toEqual({
      applied: false,
      skipReason: 'manual-crop',
    });
  });

  it('re-applies over a crop it previously applied itself', () => {
    const previous = suggestion({ rect: letterbox, applied: true });
    const tighter = { left: 0, top: 0.15, width: 1, height: 0.7 };
    expect(
      decideAutoCrop({
        rect: tighter,
        existingCrop: letterbox,
        previous,
      })
    ).toEqual({ crop: tighter, applied: true });
  });

  it('treats a stored full-frame crop as a no-op it may overwrite', () => {
    expect(
      decideAutoCrop({ rect: letterbox, existingCrop: FULL_FRAME_CROP })
    ).toEqual({ crop: letterbox, applied: true });
  });

  it('resets a crop it owns when the border is gone', () => {
    const previous = suggestion({ rect: letterbox, applied: true });
    expect(
      decideAutoCrop({
        rect: FULL_FRAME_CROP,
        existingCrop: letterbox,
        previous,
      })
    ).toEqual({
      crop: FULL_FRAME_CROP,
      applied: false,
      skipReason: 'full-frame',
    });
  });

  it('leaves an unowned crop alone even when it finds no border', () => {
    const manual = { left: 0.1, top: 0.1, width: 0.5, height: 0.5 };
    expect(
      decideAutoCrop({ rect: FULL_FRAME_CROP, existingCrop: manual })
    ).toEqual({ applied: false, skipReason: 'manual-crop' });
  });

  it('honours overridden thresholds', () => {
    const gentle = { left: 0, top: 0.005, width: 1, height: 0.99 };
    expect(
      decideAutoCrop({ rect: gentle, thresholds: { minTrimFraction: 0.001 } })
    ).toEqual({ crop: gentle, applied: true });
  });
});

describe('autoCropOwnsCrop', () => {
  const rect = { left: 0, top: 0.13, width: 1, height: 0.74 };

  it('owns an unset crop', () => {
    expect(autoCropOwnsCrop(undefined, null)).toBe(true);
  });

  it('does not own a crop with no prior applied suggestion', () => {
    expect(autoCropOwnsCrop(rect, null)).toBe(false);
    expect(autoCropOwnsCrop(rect, suggestion({ rect, applied: false }))).toBe(
      false
    );
  });

  it('owns a crop that still matches what it applied', () => {
    expect(autoCropOwnsCrop(rect, suggestion({ rect, applied: true }))).toBe(
      true
    );
  });

  it('gives up ownership once the crop was edited away from its suggestion', () => {
    const edited = { left: 0, top: 0.2, width: 1, height: 0.6 };
    expect(autoCropOwnsCrop(edited, suggestion({ rect, applied: true }))).toBe(
      false
    );
  });
});

describe('cropRectsEqual', () => {
  it('tolerates float noise', () => {
    expect(
      cropRectsEqual(
        { left: 0, top: 0.1, width: 1, height: 0.8 },
        { left: 0, top: 0.1000004, width: 1, height: 0.8 }
      )
    ).toBe(true);
  });

  it('separates genuinely different rects', () => {
    expect(
      cropRectsEqual(
        { left: 0, top: 0.1, width: 1, height: 0.8 },
        { left: 0, top: 0.2, width: 1, height: 0.6 }
      )
    ).toBe(false);
  });
});
