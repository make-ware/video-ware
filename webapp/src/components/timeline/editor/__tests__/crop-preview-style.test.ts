import { describe, it, expect } from 'vitest';
import { containBox, cropPreviewStyle } from '../crop-preview-style';

const LANDSCAPE = 16 / 9;
const PORTRAIT = 9 / 16;

describe('containBox', () => {
  it('pillarboxes a narrower inner box and letterboxes a wider one', () => {
    expect(containBox(LANDSCAPE, 1)).toEqual({
      left: (100 - 56.25) / 2,
      top: 0,
      width: 56.25,
      height: 100,
    });
    expect(containBox(1, LANDSCAPE)).toEqual({
      left: 0,
      top: (100 - 56.25) / 2,
      width: 100,
      height: 56.25,
    });
    expect(containBox(LANDSCAPE, LANDSCAPE)).toEqual({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });
  });
});

describe('cropPreviewStyle', () => {
  it('positions a vertical reframe of 16:9 media inside a 16:9 stage', () => {
    // 9:16 window over 16:9 media: rect width = (9/16)/(16/9) ≈ 0.3164
    const rect = { left: 0.25, top: 0, width: 0.5, height: 1 };
    const style = cropPreviewStyle({
      stageAspect: LANDSCAPE,
      mediaAspect: LANDSCAPE,
      rect,
    });
    // croppedAspect = 16/9 × 0.5 = 8/9 → pillarboxed at 50% of the stage.
    expect(style.frame).toEqual({
      left: '25%',
      top: '0%',
      width: '50%',
      height: '100%',
    });
    // Video doubles so the 0.5-wide window fills the wrapper, shifted so the
    // window's left edge lands at 0.
    expect(style.video).toEqual({
      left: '-50%',
      top: '0%',
      width: '200%',
      height: '100%',
    });
  });

  it('fills a portrait stage edge-to-edge when the crop matches its aspect', () => {
    // Exact 9:16 window over 16:9 media: width = (9/16)/(16/9) = 81/256.
    const rect = { left: 0.3418, top: 0, width: 81 / 256, height: 1 };
    const style = cropPreviewStyle({
      stageAspect: PORTRAIT,
      mediaAspect: LANDSCAPE,
      rect,
    });
    // croppedAspect ≈ 9/16 → the wrapper IS the stage.
    expect(style.frame.width).toBe('100%');
    expect(style.frame.height).toBe('100%');
  });

  it('passes through untouched geometry for no-crop and unknown aspect', () => {
    const passthrough = {
      left: '0%',
      top: '0%',
      width: '100%',
      height: '100%',
    };
    for (const opts of [
      { stageAspect: LANDSCAPE, mediaAspect: LANDSCAPE, rect: null },
      { stageAspect: LANDSCAPE, mediaAspect: LANDSCAPE, rect: undefined },
      {
        stageAspect: LANDSCAPE,
        mediaAspect: 0, // unknown geometry must degrade to full frame
        rect: { left: 0.25, top: 0, width: 0.5, height: 1 },
      },
    ]) {
      const style = cropPreviewStyle(opts);
      expect(style.frame).toEqual(passthrough);
      expect(style.video).toEqual(passthrough);
      expect(style.key).toBe('full');
    }
  });

  it('keys styles by their inputs so appliedCropKey suppresses rewrites', () => {
    const rect = { left: 0.25, top: 0.1, width: 0.5, height: 0.8 };
    const a = cropPreviewStyle({
      stageAspect: LANDSCAPE,
      mediaAspect: LANDSCAPE,
      rect,
    });
    const b = cropPreviewStyle({
      stageAspect: LANDSCAPE,
      mediaAspect: LANDSCAPE,
      rect: { ...rect },
    });
    expect(a.key).toBe(b.key);
    const c = cropPreviewStyle({
      stageAspect: PORTRAIT,
      mediaAspect: LANDSCAPE,
      rect,
    });
    expect(c.key).not.toBe(a.key);
  });
});
