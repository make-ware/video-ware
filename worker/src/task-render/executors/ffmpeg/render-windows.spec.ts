import { describe, it, expect } from 'vitest';
import { planRenderWindows, clipTracksToWindow } from './render-windows';
import type { TimelineTrack } from '@project/shared';

/** Sequential video clips of `clipSec` each, one per segment. */
function sequentialClips(count: number, clipSec: number): TimelineTrack[] {
  return [
    {
      id: 'video',
      type: 'video',
      layer: 0,
      segments: Array.from({ length: count }, (_, i) => ({
        id: `seg${i}`,
        assetId: `asset${i}`,
        type: 'video' as const,
        time: { start: i * clipSec, duration: clipSec, sourceStart: 0 },
      })),
    },
  ];
}

function expectContiguousCoverage(
  windows: { start: number; end: number }[],
  totalDuration: number
) {
  expect(windows[0].start).toBe(0);
  expect(windows[windows.length - 1].end).toBe(totalDuration);
  for (let i = 1; i < windows.length; i++) {
    expect(windows[i].start).toBe(windows[i - 1].end);
  }
}

describe('planRenderWindows', () => {
  it('cuts on the target window length when inputs stay under the cap', () => {
    const tracks = sequentialClips(100, 20); // 2000s total
    const windows = planRenderWindows(tracks, 2000, {
      windowSec: 60,
      maxInputsPerPass: 24,
    });

    expectContiguousCoverage(windows, 2000);
    for (const w of windows) {
      expect(w.end - w.start).toBeLessThanOrEqual(60);
      expect(w.inputCount).toBeLessThanOrEqual(24);
    }
    // 2000s / 60s → 33 full windows + a 20s tail
    expect(windows.length).toBe(34);
    expect(windows[33].end - windows[33].start).toBeCloseTo(20, 6);
  });

  it('cuts early when a full window would exceed the input cap', () => {
    const tracks = sequentialClips(30, 2); // 60s total, dense
    const windows = planRenderWindows(tracks, 60, {
      windowSec: 60,
      maxInputsPerPass: 5,
    });

    expectContiguousCoverage(windows, 60);
    // 5 clips of 2s per window → 10s windows
    expect(windows.length).toBe(6);
    for (const w of windows) {
      expect(w.end - w.start).toBeCloseTo(10, 6);
      expect(w.inputCount).toBe(5);
    }
  });

  it('emits the smallest window over-cap when clips are stacked at one instant', () => {
    const stacked: TimelineTrack[] = [
      {
        id: 'stack',
        type: 'video',
        layer: 0,
        segments: Array.from({ length: 30 }, (_, i) => ({
          id: `stacked${i}`,
          assetId: `asset${i}`,
          type: 'video' as const,
          time: { start: 0, duration: 10, sourceStart: 0 },
        })),
      },
      {
        id: 'tail',
        type: 'video',
        layer: 1,
        segments: [
          {
            id: 'tail0',
            assetId: 'tail-asset',
            type: 'video' as const,
            time: { start: 10, duration: 10, sourceStart: 0 },
          },
        ],
      },
    ];

    const windows = planRenderWindows(stacked, 20, {
      windowSec: 60,
      maxInputsPerPass: 24,
    });

    expectContiguousCoverage(windows, 20);
    // Time-splitting can't reduce 30 simultaneous clips: the smallest
    // candidate window is emitted over-cap so the caller can warn.
    expect(windows[0]).toEqual({ start: 0, end: 10, inputCount: 30 });
    expect(windows[1]).toEqual({ start: 10, end: 20, inputCount: 1 });
  });

  it('snaps cap-forced cuts to 0.1s multiples', () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'video',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 'a',
            assetId: 'asset-a',
            type: 'video',
            time: { start: 0, duration: 2.04, sourceStart: 0 },
          },
          {
            id: 'b',
            assetId: 'asset-b',
            type: 'video',
            time: { start: 2.04, duration: 3.96, sourceStart: 0 },
          },
        ],
      },
    ];

    const windows = planRenderWindows(tracks, 6, {
      windowSec: 60,
      maxInputsPerPass: 1,
    });

    expectContiguousCoverage(windows, 6);
    // The clip boundary at 2.04 snaps to the ms-exact, 30fps-aligned 2.0
    expect(windows[0].end).toBe(2);
    // Every internal boundary lands on the 0.1s grid
    for (const w of windows.slice(0, -1)) {
      expect(Math.round(w.end * 10)).toBeCloseTo(w.end * 10, 9);
    }
  });

  it('ignores text and audio when counting inputs', () => {
    const tracks: TimelineTrack[] = [
      ...sequentialClips(2, 30),
      {
        id: 'audio',
        type: 'audio',
        layer: 1,
        segments: Array.from({ length: 50 }, (_, i) => ({
          id: `aud${i}`,
          assetId: `aud-asset${i}`,
          type: 'audio' as const,
          time: { start: i, duration: 1, sourceStart: 0 },
        })),
      },
      {
        id: 'captions',
        type: 'text',
        layer: 2,
        segments: [
          {
            id: 'txt',
            type: 'text' as const,
            time: { start: 0, duration: 60 },
            text: { content: 'lower third' },
          },
        ],
      },
    ];

    const windows = planRenderWindows(tracks, 60, {
      windowSec: 60,
      maxInputsPerPass: 24,
    });

    // 2 video inputs never exceed the cap despite 50 audio segments
    expect(windows).toEqual([{ start: 0, end: 60, inputCount: 2 }]);
  });

  it('returns no windows for an empty timeline', () => {
    expect(
      planRenderWindows([], 0, { windowSec: 60, maxInputsPerPass: 24 })
    ).toEqual([]);
  });
});

describe('clipTracksToWindow', () => {
  const window = { start: 10, end: 20, inputCount: 0 };

  it('drops audio tracks entirely', () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'audio',
        type: 'audio',
        layer: 0,
        segments: [
          {
            id: 'aud',
            assetId: 'aud-asset',
            type: 'audio',
            time: { start: 12, duration: 4, sourceStart: 0 },
          },
        ],
      },
    ];
    expect(clipTracksToWindow(tracks, window)).toEqual([]);
  });

  it('clips a straddling video segment and advances its source seek', () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'video',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 'seg',
            assetId: 'asset',
            type: 'video',
            time: { start: 5, duration: 10, sourceStart: 100 },
          },
        ],
      },
    ];

    const [track] = clipTracksToWindow(tracks, window);
    expect(track.segments[0].time).toEqual({
      start: 0, // overlap starts at t0
      duration: 5, // [10, 15) of the timeline
      sourceStart: 105, // 5s of the head clipped off → seek advances 5s
    });
  });

  it('applies half-open edges: end at t0 and start at t1 are excluded', () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'video',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 'before',
            assetId: 'a',
            type: 'video',
            time: { start: 5, duration: 5, sourceStart: 0 }, // ends exactly at 10
          },
          {
            id: 'after',
            assetId: 'b',
            type: 'video',
            time: { start: 20, duration: 5, sourceStart: 0 }, // starts exactly at 20
          },
          {
            id: 'inside',
            assetId: 'c',
            type: 'video',
            time: { start: 12, duration: 4, sourceStart: 7 },
          },
        ],
      },
    ];

    const [track] = clipTracksToWindow(tracks, window);
    expect(track.segments.map((s) => s.id)).toEqual(['inside']);
    expect(track.segments[0].time).toEqual({
      start: 2,
      duration: 4,
      sourceStart: 7, // fully inside — untouched
    });
  });

  it('shifts text segments without clipping them', () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'captions',
        type: 'text',
        layer: 1,
        segments: [
          {
            id: 'txt',
            type: 'text',
            time: { start: 5, duration: 10 }, // straddles the window start
            text: {
              content: 'lower third',
              cues: [{ text: 'hi', start: 0, end: 10 }],
            },
          },
        ],
      },
    ];

    const [track] = clipTracksToWindow(tracks, window);
    // Start shifts by -t0 (may go negative); duration and cues untouched —
    // drawtext enable bounds outside [0, windowLen) simply don't draw.
    expect(track.segments[0].time).toEqual({ start: -5, duration: 10 });
    expect(track.segments[0].text?.cues).toEqual([
      { text: 'hi', start: 0, end: 10 },
    ]);
  });

  it('omits tracks left with no overlapping segments', () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'video',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 'elsewhere',
            assetId: 'a',
            type: 'video',
            time: { start: 30, duration: 5, sourceStart: 0 },
          },
        ],
      },
    ];
    expect(clipTracksToWindow(tracks, window)).toEqual([]);
  });
});
