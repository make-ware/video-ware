import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakePb, type Stub } from './fake-pb.js';
import { centrePixel, makeSpriteSheet, TILE_COLOURS } from './jpeg-fixture.js';

const sheet = makeSpriteSheet({ cols: 4, tileWidth: 16, tileHeight: 16 });

const apiFetch = vi.fn(async () => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  arrayBuffer: async () =>
    sheet.jpeg.buffer.slice(
      sheet.jpeg.byteOffset,
      sheet.jpeg.byteOffset + sheet.jpeg.byteLength
    ),
}));

vi.mock('../lib/http.js', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...(args as [])),
  uploadFetch: vi.fn(),
  resetUploadConnections: vi.fn(),
}));

const {
  assertSingleFrameSource,
  defaultFrameFilename,
  extractFrame,
  loadFilmstripFiles,
  resolveFrameSource,
  resolveFramePath,
  selectFrameTile,
} = await import('../lib/frame.js');
const { normalizeFilmstripSegments } = await import('@project/shared');

/** A filmstrip Files record covering [index*100, index*100+100). */
function filmstripFile(id: string, segmentIndex: number) {
  return {
    id,
    file: 'strip.jpg',
    fileType: 'filmstrip',
    fileSource: 'pocketbase',
    meta: {
      mimeType: 'image/jpeg',
      filmstripConfig: {
        cols: sheet.cols,
        rows: 1,
        tileWidth: sheet.tileWidth,
        tileHeight: 180, // deliberately wrong — must never be used
        segmentIndex,
        startTime: segmentIndex * sheet.cols,
        fps: 1,
      },
    },
  };
}

/** A video Media with its filmstrips already expanded (the mutator default). */
function videoMedia(
  overrides: Record<string, unknown> = {},
  segments = 1
): Record<string, unknown> {
  const files = Array.from({ length: segments }, (_, i) =>
    filmstripFile(`f${i}`, i)
  );
  return {
    id: 'm1',
    WorkspaceRef: 'ws1',
    mediaType: 'video',
    duration: sheet.cols * segments,
    width: 1920,
    height: 1080,
    filmstripFileRefs: files.map((f) => f.id),
    expand: { filmstripFileRefs: files },
    ...overrides,
  };
}

function pbWith(
  media: Record<string, unknown>,
  extra: Record<string, Stub> = {}
) {
  return fakePb({
    Media: { getOne: vi.fn(async () => media) },
    Files: { getFullList: vi.fn(async () => []) },
    ...extra,
  });
}

beforeEach(() => {
  apiFetch.mockClear();
});

describe('assertSingleFrameSource', () => {
  it('demands a source', () => {
    expect(() => assertSingleFrameSource({})).toThrow(/Pass --media/);
  });

  it('refuses more than one', () => {
    expect(() => assertSingleFrameSource({ media: 'm1', clip: 'c1' })).toThrow(
      /mutually exclusive/
    );
    expect(() =>
      assertSingleFrameSource({ clip: 'c1', timelineClip: 't1' })
    ).toThrow(/mutually exclusive/);
  });

  it('accepts exactly one', () => {
    expect(() => assertSingleFrameSource({ media: 'm1' })).not.toThrow();
  });
});

describe('resolveFrameSource', () => {
  it('takes --at as absolute seconds for a media', async () => {
    const pb = pbWith(videoMedia({ duration: 200 }));
    const source = await resolveFrameSource(pb, { media: 'm1' }, 12.5);
    expect(source).toMatchObject({
      kind: 'media',
      sourceId: 'm1',
      atDomain: 'media',
      sourceTime: 12.5,
      maxAt: 200,
    });
  });

  it('refuses a media time past the end', async () => {
    const pb = pbWith(videoMedia({ duration: 95.3 }));
    await expect(resolveFrameSource(pb, { media: 'm1' }, 130)).rejects.toThrow(
      /--at 130\.00s is past the end of media m1 \(duration 95\.30s\)/
    );
  });

  it('takes --at as a clip offset for a plain media clip', async () => {
    const pb = pbWith(videoMedia(), {
      MediaClips: {
        getOne: vi.fn(async () => ({
          id: 'mc1',
          MediaRef: 'm1',
          WorkspaceRef: 'ws1',
          start: 10,
          end: 20,
        })),
      },
    });
    const source = await resolveFrameSource(pb, { clip: 'mc1' }, 3);
    expect(source).toMatchObject({
      kind: 'clip',
      sourceId: 'mc1',
      atDomain: 'offset',
      sourceTime: 13,
      maxAt: 10,
    });
  });

  it('skips a composite clip’s cut gap', async () => {
    // Plays 10-12 then 15-20: offset 3 is one second past the cut.
    const pb = pbWith(videoMedia(), {
      MediaClips: {
        getOne: vi.fn(async () => ({
          id: 'mc1',
          MediaRef: 'm1',
          WorkspaceRef: 'ws1',
          start: 10,
          end: 20,
          clipData: {
            segments: [
              { start: 10, end: 12 },
              { start: 15, end: 20 },
            ],
          },
        })),
      },
    });
    const source = await resolveFrameSource(pb, { clip: 'mc1' }, 3);
    expect(source.sourceTime).toBe(16);
    expect(source.maxAt).toBe(7);
  });

  it('refuses a clip offset past what the clip plays', async () => {
    const pb = pbWith(videoMedia(), {
      MediaClips: {
        getOne: vi.fn(async () => ({
          id: 'mc1',
          MediaRef: 'm1',
          WorkspaceRef: 'ws1',
          start: 0,
          end: 7.5,
        })),
      },
    });
    await expect(resolveFrameSource(pb, { clip: 'mc1' }, 12)).rejects.toThrow(
      /past the end of clip mc1 \(it plays 7\.50s.*not a timeline time\)/s
    );
  });

  it('maps a timeline clip offset through its own edit list', async () => {
    const pb = pbWith(videoMedia(), {
      TimelineClips: {
        getOne: vi.fn(async () => ({
          id: 'tc1',
          TimelineRef: 'tl1',
          MediaRef: 'm1',
          start: 5,
          end: 15,
          meta: {
            segments: [
              { start: 5, end: 7 },
              { start: 12, end: 15 },
            ],
          },
        })),
      },
    });
    const source = await resolveFrameSource(pb, { timelineClip: 'tc1' }, 3);
    expect(source).toMatchObject({
      kind: 'timeline-clip',
      atDomain: 'offset',
      sourceTime: 13,
    });
  });

  it('explains a caption clip', async () => {
    const pb = pbWith(videoMedia(), {
      TimelineClips: {
        getOne: vi.fn(async () => ({
          id: 'cap1',
          TimelineRef: 'tl1',
          CaptionRef: 'c1',
          start: 0,
          end: 4,
        })),
      },
    });
    await expect(
      resolveFrameSource(pb, { timelineClip: 'cap1' }, 0)
    ).rejects.toThrow(/it is a caption, and rendered text has no frames/);
  });

  it('points a nested-timeline clip at the timeline inside it', async () => {
    const pb = pbWith(videoMedia(), {
      TimelineClips: {
        getOne: vi.fn(async () => ({
          id: 'nest1',
          TimelineRef: 'tl1',
          SourceTimelineRef: 'tl2',
          start: 0,
          end: 4,
        })),
      },
    });
    await expect(
      resolveFrameSource(pb, { timelineClip: 'nest1' }, 0)
    ).rejects.toThrow(
      /nested timeline tl2 — read frames from the clips inside it/
    );
  });
});

describe('loadFilmstripFiles', () => {
  it('uses the mutator’s default expand with no extra query', async () => {
    const getFullList = vi.fn(async () => []);
    const pb = fakePb({ Files: { getFullList } });
    const files = await loadFilmstripFiles(pb, videoMedia({}, 2) as never);
    expect(files.map((f) => f.id)).toEqual(['f0', 'f1']);
    expect(getFullList).not.toHaveBeenCalled();
  });

  it('falls back to a bound id query when the expand came back short', async () => {
    const media = videoMedia({}, 2);
    (media.expand as { filmstripFileRefs: unknown[] }).filmstripFileRefs = [
      filmstripFile('f0', 0),
    ];
    const getFullList = vi.fn(async (_options: { filter: string }) => [
      filmstripFile('f0', 0),
      filmstripFile('f1', 1),
    ]);
    const pb = fakePb({ Files: { getFullList } });

    await loadFilmstripFiles(pb, media as never);
    // fakePb.filter echoes the substituted string — ids must be bound one
    // clause at a time, never interpolated into the template.
    expect(getFullList.mock.calls[0][0].filter).toBe('id = f0 || id = f1');
  });

  it('is empty when the media has no filmstrip refs', async () => {
    const pb = fakePb({});
    expect(
      await loadFilmstripFiles(
        pb,
        videoMedia({ filmstripFileRefs: [] }) as never
      )
    ).toEqual([]);
  });
});

describe('selectFrameTile', () => {
  const segments = normalizeFilmstripSegments([
    filmstripFile('f0', 0),
    filmstripFile('f1', 1),
  ]);
  const duration = sheet.cols * 2;

  it('picks the tile covering the time', () => {
    const tile = selectFrameTile(segments, duration, 2.9);
    expect(tile).toMatchObject({
      index: 2,
      col: 2,
      row: 0,
      frameTime: 2,
      clamped: false,
    });
    expect(tile.segment.fileId).toBe('f0');
  });

  it('crosses into the next segment at its boundary', () => {
    const tile = selectFrameTile(segments, duration, sheet.cols);
    expect(tile.segment.fileId).toBe('f1');
    expect(tile.index).toBe(0);
  });

  it('never returns a black padding tile past the media end', () => {
    // A media only 2s long still gets a full 4-cell sheet; cells 2-3 are black.
    const short = normalizeFilmstripSegments([filmstripFile('f0', 0)]);
    const tile = selectFrameTile(short, 2, 3.5);
    expect(tile.index).toBe(1);
    expect(tile.clamped).toBe(true);
  });

  it('clamps to the nearest segment when nothing covers the time', () => {
    const tile = selectFrameTile(segments, duration, 9999);
    expect(tile.segment.fileId).toBe('f1');
    expect(tile.clamped).toBe(true);
  });
});

describe('defaultFrameFilename', () => {
  it('names the media and the time', () => {
    expect(defaultFrameFilename('m1', 12.5)).toBe('frame-m1-12.50s.jpg');
    expect(defaultFrameFilename('m1', 0)).toBe('frame-m1-0.00s.jpg');
  });
});

describe('resolveFramePath', () => {
  const never = () => false;
  const always = () => true;

  it('defaults to the working directory', () => {
    expect(resolveFramePath(undefined, 'f.jpg', '/cwd', never)).toBe(
      '/cwd/f.jpg'
    );
  });

  it('treats a relative path as a file under the working directory', () => {
    expect(resolveFramePath('out.jpg', 'f.jpg', '/cwd', never)).toBe(
      '/cwd/out.jpg'
    );
  });

  it('keeps an absolute file path', () => {
    expect(resolveFramePath('/abs/out.jpg', 'f.jpg', '/cwd', never)).toBe(
      '/abs/out.jpg'
    );
  });

  it('writes the default name into an existing directory', () => {
    expect(resolveFramePath('/tmp/frames', 'f.jpg', '/cwd', always)).toBe(
      '/tmp/frames/f.jpg'
    );
  });

  it('treats a trailing separator as a directory even if it does not exist', () => {
    expect(resolveFramePath('/tmp/frames/', 'f.jpg', '/cwd', never)).toBe(
      '/tmp/frames/f.jpg'
    );
  });
});

describe('extractFrame', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vw-frame-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the cropped tile as a JPEG', async () => {
    const pb = pbWith(videoMedia({ duration: sheet.cols }));
    const out = join(dir, 'shot.jpg');
    const result = await extractFrame(pb, { media: 'm1', at: 2, out });

    expect(result.path).toBe(out);
    expect(result.image).toMatchObject({
      width: sheet.tileWidth,
      height: sheet.tileHeight,
      format: 'jpeg',
      geometrySource: 'decoded',
    });
    expect(result.tile.index).toBe(2);

    // The bytes on disk really are tile 2, not the whole sheet.
    const { decodeFilmstripJpeg } = await import('../lib/frame-image.js');
    const written = decodeFilmstripJpeg(await readFile(out), 'written frame');
    expect(written.width).toBe(sheet.tileWidth);
    const [r, g, b] = centrePixel(written);
    const [er, eg, eb] = TILE_COLOURS[2];
    expect(Math.abs(r - er)).toBeLessThanOrEqual(14);
    expect(Math.abs(g - eg)).toBeLessThanOrEqual(14);
    expect(Math.abs(b - eb)).toBeLessThanOrEqual(14);
  });

  it('ignores the stored tileHeight and uses the decoded size', async () => {
    // filmstripFile() claims tileHeight 180; the sheet is really 16px tall.
    const pb = pbWith(videoMedia({ duration: sheet.cols }));
    const result = await extractFrame(pb, {
      media: 'm1',
      at: 1,
      out: join(dir, 'a.jpg'),
    });
    expect(result.image.height).toBe(sheet.tileHeight);
  });

  it('returns base64 and writes nothing with --base64', async () => {
    const pb = pbWith(videoMedia({ duration: sheet.cols }));
    const result = await extractFrame(pb, { media: 'm1', at: 2, base64: true });

    expect(result.path).toBeNull();
    expect(result.base64).toBeTruthy();
    const bytes = Buffer.from(result.base64 as string, 'base64');
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
    expect(bytes.length).toBe(result.image.bytes);
  });

  it('refuses --base64 together with an output path', async () => {
    const pb = pbWith(videoMedia());
    await expect(
      extractFrame(pb, { media: 'm1', at: 0, base64: true, out: 'x.jpg' })
    ).rejects.toThrow(/drop -o\/--force/);
  });

  it('refuses to overwrite without --force', async () => {
    const pb = pbWith(videoMedia({ duration: sheet.cols }));
    const out = join(dir, 'taken.jpg');
    await writeFile(out, 'existing');

    await expect(extractFrame(pb, { media: 'm1', at: 0, out })).rejects.toThrow(
      /Refusing to overwrite .*taken\.jpg — pass --force/
    );
    expect(await readFile(out, 'utf8')).toBe('existing');

    const result = await extractFrame(pb, {
      media: 'm1',
      at: 0,
      out,
      force: true,
    });
    expect(result.path).toBe(out);
    expect((await readFile(out)).length).toBeGreaterThan(100);
  });

  it('refuses an output directory that does not exist', async () => {
    const pb = pbWith(videoMedia({ duration: sheet.cols }));
    const out = join(dir, 'nope', 'shot.jpg');
    await expect(extractFrame(pb, { media: 'm1', at: 0, out })).rejects.toThrow(
      /Output directory does not exist/
    );
    expect(existsSync(join(dir, 'nope'))).toBe(false);
  });

  it('warns about the 1 fps quantization when it moved the time', async () => {
    const pb = pbWith(videoMedia({ duration: sheet.cols }));
    const result = await extractFrame(pb, {
      media: 'm1',
      at: 2.6,
      out: join(dir, 'q.jpg'),
    });
    expect(result.frameTime).toBe(2);
    expect(result.warnings.join('\n')).toMatch(
      /sample 1 fps.*captured at 2\.00s/s
    );
  });

  it('says how to generate a missing filmstrip', async () => {
    const pb = pbWith(
      videoMedia({ filmstripFileRefs: [], expand: { filmstripFileRefs: [] } })
    );
    await expect(extractFrame(pb, { media: 'm1', at: 0 })).rejects.toThrow(
      /vw job transcode -m m1 -a filmstrip/
    );
  });

  it('rejects audio and image media before any query', async () => {
    const pb = pbWith(videoMedia({ mediaType: 'audio' }));
    await expect(extractFrame(pb, { media: 'm1', at: 0 })).rejects.toThrow(
      /Media m1 is audio — only video media has filmstrip frames/
    );
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('refuses to read bytes from an original upload', async () => {
    const original = { ...filmstripFile('f0', 0), fileType: 'original' };
    const pb = pbWith(
      videoMedia({
        duration: sheet.cols,
        filmstripFileRefs: ['f0'],
        expand: { filmstripFileRefs: [original] },
      })
    );
    await expect(extractFrame(pb, { media: 'm1', at: 0 })).rejects.toThrow(
      /referenced as a filmstrip but is fileType "original"/
    );
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
