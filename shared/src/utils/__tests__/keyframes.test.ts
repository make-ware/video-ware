import { describe, it, expect } from 'vitest';
import {
  bboxArea,
  bboxCenter,
  bboxIntersects,
  bboxToPixels,
  decimateKeyframes,
  interpolateBbox,
  normalizeKeyframes,
  roundKeyframe,
  sampleKeyframes,
  unionBbox,
  type Keyframe,
} from '../keyframes';

/** A keyframe in the exact shape the normalizers persist. */
function kf(t: number, box: [number, number, number, number], c = 0.5) {
  const [left, top, right, bottom] = box;
  return { t, bbox: { left, top, right, bottom }, confidence: c };
}

/** An 8 fps run of `count` frames starting at `start`, drifting right. */
function run(start: number, count: number): Keyframe[] {
  return Array.from({ length: count }, (_, i) =>
    kf(start + i * 0.125, [0.1 + i * 0.01, 0.2, 0.3 + i * 0.01, 0.4])
  );
}

describe('normalizeKeyframes', () => {
  it('parses stored absolute times when no track start is given', () => {
    const parsed = normalizeKeyframes([kf(5.75, [0, 0, 1, 1])]);
    expect(parsed[0].t).toBe(5.75);
  });

  it('rebases to track-relative offsets when a track start is given', () => {
    const parsed = normalizeKeyframes([kf(5.75, [0, 0, 1, 1])], 5.75);
    expect(parsed[0].t).toBe(0);
  });

  it('sorts out-of-order frames', () => {
    const parsed = normalizeKeyframes([
      kf(2, [0, 0, 1, 1]),
      kf(0, [0, 0, 1, 1]),
      kf(1, [0, 0, 1, 1]),
    ]);
    expect(parsed.map((k) => k.t)).toEqual([0, 1, 2]);
  });

  it('drops malformed entries rather than throwing', () => {
    const parsed = normalizeKeyframes([
      null,
      { t: 'nope', bbox: { left: 0, top: 0, right: 1, bottom: 1 } },
      { t: 1 },
      { t: 2, bbox: { left: 0, top: 0, right: 1 } },
      { t: NaN, bbox: { left: 0, top: 0, right: 1, bottom: 1 } },
      kf(3, [0, 0, 1, 1]),
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].t).toBe(3);
  });

  it('reads a non-array (speech/speaker write [], legacy rows write null) as empty', () => {
    expect(normalizeKeyframes(null)).toEqual([]);
    expect(normalizeKeyframes(undefined)).toEqual([]);
    expect(normalizeKeyframes([])).toEqual([]);
    expect(normalizeKeyframes('')).toEqual([]);
  });

  it('passes provider extras through untouched', () => {
    const parsed = normalizeKeyframes([
      { ...kf(1, [0, 0, 1, 1]), attributes: { smiling: 0.9 } },
    ]);
    expect(parsed[0].attributes).toEqual({ smiling: 0.9 });
  });
});

describe('interpolateBbox', () => {
  const frames = [kf(0, [0, 0, 0.2, 0.2]), kf(2, [0.8, 0.8, 1, 1])];

  it('returns null for a track with no spatial keyframes', () => {
    expect(interpolateBbox([], 1)).toBeNull();
  });

  it('interpolates linearly between the surrounding frames', () => {
    const box = interpolateBbox(frames, 1);
    expect(box?.left).toBeCloseTo(0.4, 10);
    expect(box?.top).toBeCloseTo(0.4, 10);
    expect(box?.right).toBeCloseTo(0.6, 10);
    expect(box?.bottom).toBeCloseTo(0.6, 10);
  });

  it('holds the nearest box outside the keyframe range', () => {
    expect(interpolateBbox(frames, -5)).toEqual(frames[0].bbox);
    expect(interpolateBbox(frames, 99)).toEqual(frames[1].bbox);
  });

  it('falls back to the previous box when interpolation degenerates', () => {
    // right <= left in the result would render as an inverted overlay.
    const inverted = [kf(0, [0.2, 0.2, 0.4, 0.4]), kf(2, [0.4, 0.4, 0.2, 0.2])];
    expect(interpolateBbox(inverted, 1.9)).toEqual(inverted[0].bbox);
  });

  it('holds the previous box across a zero-length gap', () => {
    const duplicated = [kf(1, [0, 0, 0.5, 0.5]), kf(1, [0.5, 0.5, 1, 1])];
    expect(interpolateBbox(duplicated, 1)).toEqual(duplicated[1].bbox);
  });
});

describe('unionBbox', () => {
  it('covers every frame of the track', () => {
    expect(
      unionBbox([kf(0, [0.4, 0.5, 0.6, 0.7]), kf(1, [0.1, 0.6, 0.5, 0.9])])
    ).toEqual({ left: 0.1, top: 0.5, right: 0.6, bottom: 0.9 });
  });

  it('is null when there is nothing spatial — the speech/speaker case', () => {
    expect(unionBbox([])).toBeNull();
  });

  it('ignores malformed frames instead of poisoning the union with NaN', () => {
    const box = unionBbox([
      kf(0, [0.2, 0.2, 0.4, 0.4]),
      { t: 1, bbox: { left: NaN, top: 0, right: 1, bottom: 1 } } as Keyframe,
    ]);
    expect(box).toEqual({ left: 0.2, top: 0.2, right: 0.4, bottom: 0.4 });
  });

  it('matches the single frame of a one-frame track', () => {
    expect(unionBbox([kf(3, [0.1, 0.2, 0.3, 0.4])])).toEqual({
      left: 0.1,
      top: 0.2,
      right: 0.3,
      bottom: 0.4,
    });
  });
});

describe('sampleKeyframes', () => {
  it('returns everything when the track is already small enough', () => {
    const frames = run(0, 5);
    expect(sampleKeyframes(frames, 10)).toEqual(frames);
  });

  it('keeps the first and last frame so the span stays honest', () => {
    const frames = run(0, 100);
    const sampled = sampleKeyframes(frames, 12);
    expect(sampled).toHaveLength(12);
    expect(sampled[0]).toBe(frames[0]);
    expect(sampled[sampled.length - 1]).toBe(frames[frames.length - 1]);
  });

  it('never repeats a frame', () => {
    const frames = run(0, 30);
    const sampled = sampleKeyframes(frames, 12);
    expect(new Set(sampled.map((k) => k.t)).size).toBe(sampled.length);
  });

  it('spreads samples evenly rather than clustering at one end', () => {
    // 80 frames at 8 fps span indices 0–79; 5 samples land on 0, 20, 40, 59, 79.
    const sampled = sampleKeyframes(run(0, 80), 5);
    expect(sampled.map((k) => k.t)).toEqual([0, 2.5, 5, 7.375, 9.875]);
  });

  it('handles degenerate sample counts', () => {
    const frames = run(0, 10);
    expect(sampleKeyframes(frames, 0)).toEqual([]);
    expect(sampleKeyframes(frames, 1)).toEqual([frames[0]]);
    expect(sampleKeyframes([], 5)).toEqual([]);
  });
});

describe('decimateKeyframes', () => {
  it('thins an 8 fps run to one frame per second', () => {
    // 0..9.875s at 8fps; a 1s step keeps 0,1,2,…,9 plus the final frame.
    const thinned = decimateKeyframes(run(0, 80), 1);
    expect(thinned.map((k) => k.t)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9.875,
    ]);
  });

  it('is a no-op for a step of zero or less', () => {
    const frames = run(0, 20);
    expect(decimateKeyframes(frames, 0)).toEqual(frames);
    expect(decimateKeyframes(frames, -1)).toEqual(frames);
  });

  it('never drops the final frame', () => {
    const frames = run(0, 40);
    const thinned = decimateKeyframes(frames, 100);
    expect(thinned).toHaveLength(2);
    expect(thinned[1]).toBe(frames[frames.length - 1]);
  });

  it('leaves one- and two-frame tracks alone', () => {
    const two = run(0, 2);
    expect(decimateKeyframes(two, 5)).toEqual(two);
    expect(decimateKeyframes([], 5)).toEqual([]);
  });
});

describe('roundKeyframe', () => {
  it('flattens raw float64 face/person geometry to the object/text precision', () => {
    const raw = {
      t: 2.25,
      bbox: {
        left: 0.5805000066757202,
        top: 0.4902999997138977,
        right: 0.6069999933242798,
        bottom: 0.5430999994277954,
      },
      confidence: 0.7105675935745239,
    };
    expect(roundKeyframe(raw, 4)).toEqual({
      t: 2.25,
      bbox: { left: 0.5805, top: 0.4903, right: 0.607, bottom: 0.5431 },
      confidence: 0.7106,
    });
  });

  it('leaves t alone — rounding it could collide two frames', () => {
    expect(roundKeyframe(kf(5.875, [0, 0, 1, 1]), 1).t).toBe(5.875);
  });

  it('is a no-op for a nonsensical precision', () => {
    const frame = kf(1, [0.123456, 0, 1, 1]);
    expect(roundKeyframe(frame, -1)).toBe(frame);
    expect(roundKeyframe(frame, 1.5)).toBe(frame);
  });

  it('omits confidence when the stored frame has none', () => {
    const frame = { t: 1, bbox: { left: 0, top: 0, right: 1, bottom: 1 } };
    expect(roundKeyframe(frame, 4)).not.toHaveProperty('confidence');
  });
});

describe('bbox helpers', () => {
  it('converts to whole pixels of the display frame', () => {
    expect(
      bboxToPixels({ left: 0.25, top: 0.5, right: 0.75, bottom: 1 }, 1920, 1080)
    ).toEqual({
      left: 480,
      top: 540,
      right: 1440,
      bottom: 1080,
      width: 960,
      height: 540,
    });
  });

  it('returns null for a frame with no usable dimensions', () => {
    const box = { left: 0, top: 0, right: 1, bottom: 1 };
    expect(bboxToPixels(box, 0, 1080)).toBeNull();
    expect(bboxToPixels(box, 1920, 0)).toBeNull();
  });

  it('measures area as a fraction of the frame', () => {
    expect(bboxArea({ left: 0, top: 0, right: 0.5, bottom: 0.5 })).toBe(0.25);
    // An inverted box reads as zero rather than a negative area.
    expect(bboxArea({ left: 0.8, top: 0.8, right: 0.2, bottom: 0.2 })).toBe(0);
  });

  it('finds the centre point', () => {
    const centre = bboxCenter({ left: 0.2, top: 0.4, right: 0.6, bottom: 0.8 });
    expect(centre.x).toBeCloseTo(0.4, 10);
    expect(centre.y).toBeCloseTo(0.6, 10);
  });

  it('detects overlap, and treats touching edges as apart', () => {
    const a = { left: 0, top: 0, right: 0.5, bottom: 0.5 };
    expect(
      bboxIntersects(a, { left: 0.4, top: 0.4, right: 1, bottom: 1 })
    ).toBe(true);
    expect(bboxIntersects(a, { left: 0.5, top: 0, right: 1, bottom: 1 })).toBe(
      false
    );
    expect(
      bboxIntersects(a, { left: 0.6, top: 0.6, right: 1, bottom: 1 })
    ).toBe(false);
  });
});
