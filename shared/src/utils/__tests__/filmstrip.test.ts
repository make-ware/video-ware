import { describe, it, expect } from 'vitest';
import {
  lastContentTileIndex,
  normalizeFilmstripSegments,
  segmentDuration,
  segmentForTime,
  segmentsCoverage,
  tileFrameTime,
  tileIndexFor,
  tileRect,
  type FilmstripFileLike,
} from '../filmstrip.js';

/** A filmstrip File record as the worker writes it today (100x1 @ 1fps). */
function file(
  id: string,
  config: { segmentIndex?: number; startTime?: number; fps?: number }
): FilmstripFileLike {
  return {
    id,
    meta: {
      filmstripConfig: { cols: 100, rows: 1, tileWidth: 320, ...config },
    },
  };
}

describe('segmentDuration', () => {
  it('is every tile played at the sample rate', () => {
    expect(segmentDuration({ cols: 100, rows: 1, fps: 1 })).toBe(100);
    expect(segmentDuration({ cols: 10, rows: 10, fps: 2 })).toBe(50);
  });
});

describe('normalizeFilmstripSegments', () => {
  it('orders by segmentIndex, not incoming order', () => {
    const segments = normalizeFilmstripSegments([
      file('b', { segmentIndex: 2, startTime: 200, fps: 1 }),
      file('a', { segmentIndex: 0, startTime: 0, fps: 1 }),
      file('c', { segmentIndex: 1, startTime: 100, fps: 1 }),
    ]);
    expect(segments.map((s) => s.fileId)).toEqual(['a', 'c', 'b']);
  });

  it('derives fps, segmentIndex and startTime for legacy records', () => {
    // Records written before those fields existed carry only cols/rows.
    const segments = normalizeFilmstripSegments([
      file('a', {}),
      file('b', {}),
      file('c', {}),
    ]);
    expect(segments).toEqual([
      {
        fileId: 'a',
        config: { cols: 100, rows: 1, fps: 1, startTime: 0, segmentIndex: 0 },
      },
      {
        fileId: 'b',
        config: { cols: 100, rows: 1, fps: 1, startTime: 100, segmentIndex: 1 },
      },
      {
        fileId: 'c',
        config: { cols: 100, rows: 1, fps: 1, startTime: 200, segmentIndex: 2 },
      },
    ]);
  });

  it('drops records with no usable tile grid', () => {
    const segments = normalizeFilmstripSegments([
      { id: 'no-meta' },
      { id: 'no-config', meta: {} },
      file('ok', { segmentIndex: 0, startTime: 0, fps: 1 }),
    ]);
    expect(segments.map((s) => s.fileId)).toEqual(['ok']);
  });
});

describe('segmentForTime', () => {
  const segments = normalizeFilmstripSegments([
    file('a', { segmentIndex: 0, startTime: 0, fps: 1 }),
    file('b', { segmentIndex: 1, startTime: 100, fps: 1 }),
  ]);

  it('picks the segment a time falls inside', () => {
    expect(segmentForTime(segments, 0)?.fileId).toBe('a');
    expect(segmentForTime(segments, 99.9)?.fileId).toBe('a');
    expect(segmentForTime(segments, 150)?.fileId).toBe('b');
  });

  it('treats a segment boundary as the start of the NEXT segment', () => {
    expect(segmentForTime(segments, 100)?.fileId).toBe('b');
  });

  it('returns null past the last segment', () => {
    expect(segmentForTime(segments, 200)).toBeNull();
    expect(segmentForTime([], 0)).toBeNull();
  });
});

describe('segmentsCoverage', () => {
  it('spans the first start to the last end', () => {
    const segments = normalizeFilmstripSegments([
      file('a', { segmentIndex: 0, startTime: 0, fps: 1 }),
      file('b', { segmentIndex: 1, startTime: 100, fps: 1 }),
    ]);
    expect(segmentsCoverage(segments)).toEqual({ start: 0, end: 200 });
  });

  it('is null with no segments', () => {
    expect(segmentsCoverage([])).toBeNull();
  });
});

describe('tileIndexFor', () => {
  const config = { cols: 100, rows: 1, fps: 1, startTime: 100 };

  it('is the whole second elapsed since the segment start', () => {
    expect(tileIndexFor(config, 100)).toBe(0);
    expect(tileIndexFor(config, 112.9)).toBe(12);
  });

  it('clamps below the segment start and past its last tile', () => {
    expect(tileIndexFor(config, 0)).toBe(0);
    expect(tileIndexFor(config, 9999)).toBe(99);
  });

  it('walks a multi-row grid left-to-right, top-to-bottom', () => {
    const grid = { cols: 10, rows: 10, fps: 1, startTime: 0 };
    expect(tileIndexFor(grid, 0)).toBe(0);
    expect(tileIndexFor(grid, 9)).toBe(9); // last tile of row 0
    expect(tileIndexFor(grid, 10)).toBe(10); // first tile of row 1
  });
});

describe('lastContentTileIndex', () => {
  const config = { cols: 100, rows: 1, fps: 1, startTime: 0 };

  it('stops at the last real frame, not the last cell', () => {
    // ffmpeg pads a 30-frame sheet out to 100 cells with black.
    expect(lastContentTileIndex(config, 30)).toBe(29);
    expect(lastContentTileIndex(config, 30.5)).toBe(30);
  });

  it('allows the whole grid when the segment is full', () => {
    expect(lastContentTileIndex(config, 100)).toBe(99);
    expect(lastContentTileIndex(config, 5000)).toBe(99);
  });

  it('is relative to the segment start', () => {
    expect(lastContentTileIndex({ ...config, startTime: 200 }, 250)).toBe(49);
  });

  it('never goes negative for a segment past the media end', () => {
    expect(lastContentTileIndex({ ...config, startTime: 200 }, 150)).toBe(0);
  });
});

describe('tileFrameTime', () => {
  it('quantizes the request to the frame the tile actually captured', () => {
    const config = { cols: 100, rows: 1, fps: 1, startTime: 0 };
    expect(tileFrameTime(config, 12)).toBe(12);
    expect(tileFrameTime(config, 12.9)).toBe(12);
  });

  it('is relative to the segment start', () => {
    const config = { cols: 100, rows: 1, fps: 1, startTime: 100 };
    expect(tileFrameTime(config, 112.5)).toBe(112);
  });
});

describe('tileRect', () => {
  it('derives the tile from the decoded image, not stored config', () => {
    // A 4:3 source: ingest stored tileHeight 180, but ffmpeg emitted 240.
    // Trusting meta here would crop a 180px-tall sliver of a 240px tile.
    const rect = tileRect(
      { cols: 100, rows: 1 },
      { width: 32000, height: 240 },
      12
    );
    expect(rect).toEqual({ x: 3840, y: 0, width: 320, height: 240 });
  });

  it('offsets by row on a multi-row grid', () => {
    const rect = tileRect(
      { cols: 10, rows: 10 },
      { width: 1600, height: 900 },
      23
    );
    expect(rect).toEqual({ x: 480, y: 180, width: 160, height: 90 });
  });

  it('clamps an out-of-range tile index', () => {
    const geom = { cols: 4, rows: 1 };
    const image = { width: 400, height: 100 };
    expect(tileRect(geom, image, 99).x).toBe(300);
    expect(tileRect(geom, image, -5).x).toBe(0);
  });

  it('refuses a grid it cannot resolve', () => {
    expect(() =>
      tileRect({ cols: 0, rows: 1 }, { width: 100, height: 10 }, 0)
    ).toThrow(/no tile grid/);
    expect(() =>
      tileRect({ cols: 100, rows: 1 }, { width: 50, height: 10 }, 0)
    ).toThrow(/too small/);
  });
});
