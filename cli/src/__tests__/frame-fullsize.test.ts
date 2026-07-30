import { describe, it, expect, vi } from 'vitest';
import { encode } from 'jpeg-js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakePb } from './fake-pb.js';

/**
 * The frame pipeline at the dimensions production actually produces.
 *
 * `frame.test.ts` covers the logic with toy 16px sheets; this file exists for
 * the two things only real dimensions can show: that jpeg-js copes with a
 * 32000x180 strip (an aspect ratio nothing else in the codebase decodes) at
 * interactive speed, and that a portrait media's tiles come out at their real
 * height rather than the 180 every ingest stores in `filmstripConfig`.
 */

/** A `cols`-wide sprite sheet: per-tile hue, 2px white border, diagonal. */
function sheet(cols: number, tileWidth: number, tileHeight: number) {
  const width = cols * tileWidth;
  const data = new Uint8Array(width * tileHeight * 4);

  for (let t = 0; t < cols; t++) {
    const h = (t / cols) * 6;
    const c = 200;
    const x2 = c * (1 - Math.abs((h % 2) - 1));
    const rgb =
      h < 1
        ? [c, x2, 0]
        : h < 2
          ? [x2, c, 0]
          : h < 3
            ? [0, c, x2]
            : h < 4
              ? [0, x2, c]
              : h < 5
                ? [x2, 0, c]
                : [c, 0, x2];

    for (let y = 0; y < tileHeight; y++) {
      for (let x = 0; x < tileWidth; x++) {
        const border =
          x < 2 || y < 2 || x >= tileWidth - 2 || y >= tileHeight - 2;
        const diagonal = Math.abs(y / tileHeight - x / tileWidth) < 0.03;
        const [r, g, b] = border || diagonal ? [255, 255, 255] : rgb;
        const i = ((y * width + t * tileWidth + x) * 4) as number;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
  }
  return Buffer.from(encode({ width, height: tileHeight, data }, 85).data);
}

let served: Buffer = Buffer.alloc(0);

vi.mock('../lib/http.js', () => ({
  apiFetch: async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    arrayBuffer: async () =>
      served.buffer.slice(
        served.byteOffset,
        served.byteOffset + served.byteLength
      ),
  }),
  uploadFetch: vi.fn(),
  resetUploadConnections: vi.fn(),
}));

const { extractFrame } = await import('../lib/frame.js');

/** Media with three 100-tile segments, as the worker writes them. */
function pbFor(duration: number, cols = 100) {
  const files = [0, 1, 2].map((i) => ({
    id: `f${i}`,
    file: 'filmstrip.jpg',
    fileType: 'filmstrip',
    fileSource: 'pocketbase',
    meta: {
      mimeType: 'image/jpeg',
      filmstripConfig: {
        cols,
        rows: 1,
        tileWidth: 320,
        // What ingest stores for every media, correct or not.
        tileHeight: 180,
        segmentIndex: i,
        startTime: i * cols,
        fps: 1,
      },
    },
  }));
  return fakePb({
    Media: {
      getOne: vi.fn(async () => ({
        id: 'mreal',
        WorkspaceRef: 'ws1',
        mediaType: 'video',
        duration,
        filmstripFileRefs: files.map((f) => f.id),
        expand: { filmstripFileRefs: files },
      })),
    },
    Files: { getFullList: vi.fn(async () => []) },
  });
}

describe('filmstrip sheets at production dimensions', () => {
  it('cuts a 320x180 frame out of a 32000x180 strip, across segments', async () => {
    served = sheet(100, 320, 180);
    const pb = pbFor(250);
    const dir = await mkdtemp(join(tmpdir(), 'vw-frame-full-'));
    try {
      const started = Date.now();
      const first = await extractFrame(pb, {
        media: 'mreal',
        at: 12.5,
        out: join(dir, 'a.jpg'),
      });
      // Pure-JS decode of 5.8 MP has to stay interactive for a one-shot CLI.
      expect(Date.now() - started).toBeLessThan(10_000);

      expect(first.image).toMatchObject({ width: 320, height: 180 });
      expect(first.segment.segmentIndex).toBe(0);
      expect(first.tile.index).toBe(12);
      expect(first.frameTime).toBe(12);

      // The 100s segment boundary: 99 and 101 come from different sheets.
      const before = await extractFrame(pb, {
        media: 'mreal',
        at: 99,
        out: join(dir, 'b.jpg'),
      });
      const after = await extractFrame(pb, {
        media: 'mreal',
        at: 101,
        out: join(dir, 'c.jpg'),
      });
      expect([before.segment.segmentIndex, before.tile.index]).toEqual([0, 99]);
      expect([after.segment.segmentIndex, after.tile.index]).toEqual([1, 1]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('never lands on ffmpeg’s black padding at the media end', async () => {
    served = sheet(100, 320, 180);
    // 250s of media: segment 2 holds 50 real tiles; cells 50-99 are padding.
    const result = await extractFrame(pbFor(250), {
      media: 'mreal',
      at: 250,
      base64: true,
    });
    expect(result.segment.segmentIndex).toBe(2);
    expect(result.tile.index).toBe(49);
    expect(result.clamped).toBe(true);
  });

  it('cuts a portrait tile at its real height, not the stored 180', async () => {
    // 9:16 media: ffmpeg emitted 320x568 tiles, meta still claims 180.
    served = sheet(20, 320, 568);
    const result = await extractFrame(pbFor(60, 20), {
      media: 'mreal',
      at: 7,
      base64: true,
    });
    expect(result.image.width).toBe(320);
    expect(result.image.height).toBe(568);
    expect(result.image.geometrySource).toBe('decoded');
    expect(result.tile.index).toBe(7);
  });
});
