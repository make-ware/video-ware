import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WAVEFORM_HEIGHT,
  normalizeWaveformSegments,
  planWaveformChunks,
  waveformSegmentForTime,
  type WaveformFileLike,
} from '../waveform.js';

/** The config the ingest pipeline requests today: 1000px @ 1px/s. */
const CONFIG = { width: 1000, height: 200, pixelsPerSecond: 1 };

/** A waveform File record as the worker writes it. */
function file(
  id: string,
  config: {
    chunkIndex?: number;
    startTime?: number;
    duration?: number;
    width?: number;
    pixelsPerSecond?: number;
  }
): WaveformFileLike {
  return {
    id,
    meta: {
      waveformConfig: { width: 1000, height: 200, ...config },
    },
  };
}

describe('planWaveformChunks', () => {
  it('cuts full chunks at the requested scale', () => {
    const chunks = planWaveformChunks(2500, CONFIG);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({
      index: 0,
      startTime: 0,
      duration: 1000,
      width: 1000,
    });
    expect(chunks[1].startTime).toBe(1000);
    // The tail is short, so it is narrower — never stretched to full width.
    expect(chunks[2]).toEqual({
      index: 2,
      startTime: 2000,
      duration: 500,
      width: 500,
    });
  });

  it('keeps one pixel per second across every chunk', () => {
    for (const chunk of planWaveformChunks(2500, CONFIG)) {
      expect(chunk.width / chunk.duration).toBe(1);
    }
  });

  it('honors a denser scale by covering less time per chunk', () => {
    const chunks = planWaveformChunks(300, {
      ...CONFIG,
      pixelsPerSecond: 10,
    });

    // 1000px at 10px/s = 100s per chunk.
    expect(chunks).toHaveLength(3);
    expect(chunks[1]).toEqual({
      index: 1,
      startTime: 100,
      duration: 100,
      width: 1000,
    });
  });

  it('absorbs a sub-second tail into the previous chunk', () => {
    const chunks = planWaveformChunks(1000.4, CONFIG);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].duration).toBeCloseTo(1000.4);
    expect(chunks[0].width).toBe(1000);
  });

  it('emits a single short chunk for media below one chunk', () => {
    expect(planWaveformChunks(42, CONFIG)).toEqual([
      { index: 0, startTime: 0, duration: 42, width: 42 },
    ]);
  });

  it('draws nothing for media with no measurable duration', () => {
    expect(planWaveformChunks(0, CONFIG)).toEqual([]);
    expect(planWaveformChunks(-1, CONFIG)).toEqual([]);
    expect(planWaveformChunks(Number.NaN, CONFIG)).toEqual([]);
  });

  it('falls back to defaults for a config with unusable numbers', () => {
    const chunks = planWaveformChunks(1500, {
      width: 0,
      height: 0,
      pixelsPerSecond: 0,
    });

    // 1000px @ 1px/s defaults.
    expect(chunks).toHaveLength(2);
    expect(chunks[0].width).toBe(1000);
  });

  it('never plans a zero-width image', () => {
    expect(planWaveformChunks(0.2, CONFIG)[0].width).toBe(1);
  });
});

describe('normalizeWaveformSegments', () => {
  it('orders by chunkIndex, not incoming order', () => {
    const segments = normalizeWaveformSegments([
      file('b', { chunkIndex: 2, startTime: 2000, duration: 500, width: 500 }),
      file('a', { chunkIndex: 0, startTime: 0, duration: 1000 }),
      file('c', { chunkIndex: 1, startTime: 1000, duration: 1000 }),
    ]);

    expect(segments.map((s) => s.fileId)).toEqual(['a', 'c', 'b']);
  });

  it('derives startTime and duration for records that lack them', () => {
    const segments = normalizeWaveformSegments([
      file('a', { chunkIndex: 0 }),
      file('b', { chunkIndex: 1 }),
    ]);

    expect(segments[0].config).toMatchObject({ startTime: 0, duration: 1000 });
    expect(segments[1].config).toMatchObject({
      startTime: 1000,
      duration: 1000,
    });
  });

  it('derives duration from the recorded scale', () => {
    const [segment] = normalizeWaveformSegments([
      file('a', { chunkIndex: 0, width: 1000, pixelsPerSecond: 10 }),
    ]);

    expect(segment.config.duration).toBe(100);
  });

  it('defaults a missing height rather than dropping the chunk', () => {
    const [segment] = normalizeWaveformSegments([
      { id: 'a', meta: { waveformConfig: { width: 800 } as never } },
    ]);

    expect(segment.config.height).toBe(DEFAULT_WAVEFORM_HEIGHT);
  });

  it('drops records with no usable geometry', () => {
    expect(
      normalizeWaveformSegments([
        { id: 'a', meta: null },
        { id: 'b', meta: {} },
        { id: 'c', meta: { waveformConfig: { width: 0, height: 200 } } },
      ])
    ).toEqual([]);
  });
});

describe('waveformSegmentForTime', () => {
  const segments = normalizeWaveformSegments([
    file('a', { chunkIndex: 0, startTime: 0, duration: 1000 }),
    file('b', { chunkIndex: 1, startTime: 1000, duration: 500, width: 500 }),
  ]);

  it('finds the chunk covering a time', () => {
    expect(waveformSegmentForTime(segments, 0)?.fileId).toBe('a');
    expect(waveformSegmentForTime(segments, 999.9)?.fileId).toBe('a');
    expect(waveformSegmentForTime(segments, 1000)?.fileId).toBe('b');
  });

  it('returns null past the end', () => {
    expect(waveformSegmentForTime(segments, 1500)).toBeNull();
    expect(waveformSegmentForTime([], 0)).toBeNull();
  });
});
