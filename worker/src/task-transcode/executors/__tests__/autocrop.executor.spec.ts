import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  FFmpegAutoCropExecutor,
  parseCropDetectBox,
  planSampleWindows,
} from '../ffmpeg/autocrop.executor';

vi.mock('@nestjs/common', async () => {
  const actual = await vi.importActual('@nestjs/common');
  const { MockLogger } = await import('@/__mocks__/logger');
  return { ...actual, Logger: MockLogger };
});

/** A realistic cropdetect log for a 1920x1080 file with 140px bars. */
const cropdetectLog = (boxes: string[]): string =>
  [
    'Input #0, mov,mp4,m4a,3gp,3g2,mj2, from /in.mp4:',
    '  Stream #0:0: Video: h264, yuv420p, 1920x1080, 30 fps',
    ...boxes.map(
      (crop, i) =>
        `[Parsed_cropdetect_1 @ 0x55] x1:0 x2:1919 y1:140 y2:939 pts:${i} t:${i} crop=${crop}`
    ),
  ].join('\n');

describe('parseCropDetectBox', () => {
  it('reads the ffmpeg crop=w:h:x:y argument order', () => {
    expect(parseCropDetectBox(cropdetectLog(['1920:800:0:140']))).toEqual({
      width: 1920,
      height: 800,
      x: 0,
      y: 140,
    });
  });

  it('takes the LAST line — reset=0 makes it the accumulated box', () => {
    const log = cropdetectLog([
      '1920:800:0:140',
      '1920:820:0:130',
      '1920:840:0:120',
    ]);
    expect(parseCropDetectBox(log)).toEqual({
      width: 1920,
      height: 840,
      x: 0,
      y: 120,
    });
  });

  it('returns undefined when cropdetect logged nothing', () => {
    expect(
      parseCropDetectBox('Input #0, mov ...\nno filters ran')
    ).toBeUndefined();
    expect(parseCropDetectBox('')).toBeUndefined();
  });

  it('passes an all-black window through as a non-positive box', () => {
    // unionCropBoxes is what drops these; the parser must not hide them.
    expect(parseCropDetectBox(cropdetectLog(['-1:-1:-1:-1']))).toEqual({
      width: -1,
      height: -1,
      x: -1,
      y: -1,
    });
  });
});

describe('planSampleWindows', () => {
  it('skips the outer 5% and spreads windows evenly', () => {
    const offsets = planSampleWindows(100, 5, 2);
    expect(offsets).toHaveLength(5);
    expect(offsets[0]).toBeCloseTo(5);
    expect(offsets[4]).toBeCloseTo(93); // 100 - 5 margin - 2 window
    const gaps = offsets.slice(1).map((o, i) => o - offsets[i]);
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0]);
  });

  it('keeps every window inside the media', () => {
    const duration = 30;
    for (const offset of planSampleWindows(duration, 5, 2)) {
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset + 2).toBeLessThanOrEqual(duration);
    }
  });

  it('collapses to a single window when the media is too short to spread', () => {
    expect(planSampleWindows(2, 5, 2)).toEqual([0.1]);
  });

  it('falls back to one window at the start for unknown duration', () => {
    expect(planSampleWindows(0, 5, 2)).toEqual([0]);
    expect(planSampleWindows(Number.NaN, 5, 2)).toEqual([0]);
  });

  it('never returns zero windows', () => {
    expect(planSampleWindows(100, 0, 2)).toHaveLength(1);
    expect(planSampleWindows(100, -3, 2)).toHaveLength(1);
  });
});

describe('FFmpegAutoCropExecutor', () => {
  let ffmpegService: { executeCapturingStderr: ReturnType<typeof vi.fn> };
  let executor: FFmpegAutoCropExecutor;

  beforeEach(() => {
    ffmpegService = {
      executeCapturingStderr: vi
        .fn()
        .mockResolvedValue(cropdetectLog(['1920:800:0:140'])),
    };
    executor = new FFmpegAutoCropExecutor(ffmpegService as never);
  });

  const argsOf = (call: number): string[] =>
    ffmpegService.executeCapturingStderr.mock.calls[call][0];

  it('samples once per planned window and returns every box', async () => {
    const result = await executor.execute('/in.mp4', {
      durationSec: 100,
      samples: 3,
    });

    expect(ffmpegService.executeCapturingStderr).toHaveBeenCalledTimes(3);
    expect(result.attempted).toBe(3);
    expect(result.boxes).toEqual(
      Array.from({ length: 3 }, () => ({
        width: 1920,
        height: 800,
        x: 0,
        y: 140,
      }))
    );
  });

  it('seeks before the input so a deep window costs a seek, not a decode', async () => {
    await executor.execute('/in.mp4', { durationSec: 100, samples: 2 });

    const args = argsOf(1);
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(args[args.indexOf('-ss') + 1]).toBe('93');
  });

  it('writes no output file and analyses at info level', async () => {
    await executor.execute('/in.mp4', { durationSec: 100, samples: 1 });

    const args = argsOf(0);
    expect(args.slice(-3)).toEqual(['-f', 'null', '-']);
    expect(args[args.indexOf('-loglevel') + 1]).toBe('info');
  });

  it('rate-limits frames before cropdetect and accumulates within a window', async () => {
    await executor.execute('/in.mp4', {
      durationSec: 100,
      samples: 1,
      sampleFps: 4,
      limit: 32,
    });

    const filter = argsOf(0)[argsOf(0).indexOf('-vf') + 1];
    expect(filter).toBe('fps=4,cropdetect=limit=32:round=2:reset=0');
  });

  it('reports the limit it actually used', async () => {
    const defaulted = await executor.execute('/in.mp4', { durationSec: 10 });
    expect(defaulted.limit).toBe(24);

    const overridden = await executor.execute('/in.mp4', {
      durationSec: 10,
      limit: 64,
    });
    expect(overridden.limit).toBe(64);
  });

  it('degrades past a failed window instead of failing the detection', async () => {
    ffmpegService.executeCapturingStderr
      .mockRejectedValueOnce(new Error('seek past end'))
      .mockResolvedValue(cropdetectLog(['1920:800:0:140']));

    const result = await executor.execute('/in.mp4', {
      durationSec: 100,
      samples: 3,
    });

    expect(result.attempted).toBe(3);
    expect(result.boxes).toHaveLength(2);
  });

  it('reports zero boxes rather than throwing when nothing detected', async () => {
    ffmpegService.executeCapturingStderr.mockResolvedValue('no crop lines');

    const result = await executor.execute('/in.mp4', {
      durationSec: 100,
      samples: 2,
    });

    expect(result).toEqual({ boxes: [], attempted: 2, limit: 24 });
  });
});
