import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakePb, type Stub } from './fake-pb.js';

/**
 * `vw media download`: resolving one of a media's derived preview files and
 * streaming it to disk.
 *
 * The transport is stubbed at `lib/http.js` (as in frame.test.ts) with a body
 * that is a real async iterable, because streaming — not buffering — is the
 * whole point of the download path.
 */

/** Bytes the stubbed server hands back, in chunks. */
let served: Buffer[] = [];
/** Set to make the stubbed transfer fail part-way through the body. */
let failAfterChunk: number | null = null;

const apiFetch = vi.fn(async () => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  body: {
    async *[Symbol.asyncIterator]() {
      for (const [i, chunk] of served.entries()) {
        if (failAfterChunk !== null && i >= failAfterChunk) {
          throw new Error('socket hang up');
        }
        yield new Uint8Array(
          chunk.buffer.slice(
            chunk.byteOffset,
            chunk.byteOffset + chunk.byteLength
          )
        );
      }
    },
  },
}));

vi.mock('../lib/http.js', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...(args as [])),
  uploadFetch: vi.fn(),
  resetUploadConnections: vi.fn(),
}));

const {
  PREVIEW_KIND_NAMES,
  availablePreviewKinds,
  defaultPreviewFilename,
  downloadMediaPreview,
  missingPreviewMessage,
  previewExtension,
  previewSummaryLines,
  resolvePreviewFile,
  selectPreviewKind,
} = await import('../lib/download.js');

/** A Files record for a derived preview, available and PocketBase-hosted. */
function previewFile(over: Stub = {}): Stub {
  return {
    id: 'f-proxy',
    name: 'proxy.mp4',
    file: 'proxy_a1b2c3.mp4',
    size: 12,
    fileType: 'proxy',
    fileStatus: 'available',
    fileSource: 'pocketbase',
    meta: {
      mimeType: 'video/mp4',
      width: 1280,
      height: 720,
      duration: 42.5,
      fps: 30,
      codec: 'h264',
    },
    ...over,
  };
}

/** A Media with the given preview refs, expanded the way MediaMutator does. */
function mediaRecord(over: Stub = {}): Stub {
  return {
    id: 'm1',
    WorkspaceRef: 'ws1',
    name: 'holiday.mov',
    mediaType: 'video',
    duration: 42.5,
    proxyFileRef: 'f-proxy',
    expand: { proxyFileRef: previewFile() },
    ...over,
  };
}

function pbFor(media: Stub, files: Stub[] = []) {
  return fakePb({
    Media: { getOne: vi.fn(async () => media) },
    Files: {
      getOne: vi.fn(async (id: string) => {
        const found = files.find((f) => f.id === id);
        if (!found) throw new Error('not found');
        return found;
      }),
    },
    Workspaces: { getOne: vi.fn(async () => ({ id: 'ws1', name: 'ws' })) },
  });
}

beforeEach(() => {
  served = [Buffer.from('hello '), Buffer.from('world!')];
  failAfterChunk = null;
  apiFetch.mockClear();
});

describe('selectPreviewKind', () => {
  it('needs one kind flag', () => {
    expect(() => selectPreviewKind({})).toThrow(/--proxy/);
    expect(() => selectPreviewKind({})).toThrow(/--audio/);
  });

  it('refuses two at once', () => {
    expect(() => selectPreviewKind({ proxy: true, audio: true })).toThrow(
      /mutually exclusive/
    );
  });

  it('returns the one that was passed, for every kind', () => {
    for (const kind of PREVIEW_KIND_NAMES) {
      expect(selectPreviewKind({ [kind]: true })).toBe(kind);
    }
  });

  it('ignores the command’s other options', () => {
    expect(
      selectPreviewKind({ json: true, force: true, audio: true } as never)
    ).toBe('audio');
  });
});

describe('availablePreviewKinds', () => {
  it('lists only the refs the media actually carries', () => {
    expect(
      availablePreviewKinds({
        proxyFileRef: 'a',
        audioFileRef: undefined,
        thumbnailFileRef: 'c',
        spriteFileRef: undefined,
      } as never)
    ).toEqual(['proxy', 'thumbnail']);
  });
});

describe('missingPreviewMessage', () => {
  it('names what to run to generate the missing preview', () => {
    const message = missingPreviewMessage(
      { id: 'm1', proxyFileRef: 'a' } as never,
      'audio'
    );
    expect(message).toContain('Media m1 has no audio file');
    expect(message).toContain('vw job transcode -m m1 -a audio');
    // ...and what it does have, so the next command needs no extra round-trip.
    expect(message).toContain('--proxy');
  });

  it('says nothing about siblings when there are none', () => {
    const message = missingPreviewMessage({ id: 'm1' } as never, 'proxy');
    expect(message).not.toContain('It does have');
  });
});

describe('previewExtension', () => {
  it('prefers the producer’s own file name', () => {
    expect(
      previewExtension('audio', { name: 'audio.wav', file: 'x.mp3' })
    ).toBe('.wav');
  });

  it('falls back to the stored blob name, then to the kind default', () => {
    expect(previewExtension('audio', { name: 'audio', file: 'a_x9.aac' })).toBe(
      '.aac'
    );
    expect(previewExtension('audio', { name: 'audio', file: '' })).toBe('.mp3');
    expect(previewExtension('proxy', { name: '', file: '' })).toBe('.mp4');
  });

  it('ignores a dotted name that is not an extension', () => {
    // A media named "2024.05.holiday" must not yield ".holiday".
    expect(
      previewExtension('proxy', { name: '2024.05.my holiday clip', file: '' })
    ).toBe('.mp4');
  });
});

describe('defaultPreviewFilename', () => {
  it('names the kind and the media', () => {
    expect(defaultPreviewFilename('m1', 'proxy', previewFile() as never)).toBe(
      'proxy-m1.mp4'
    );
    expect(
      defaultPreviewFilename('m1', 'audio', { name: 'audio.mp3', file: '' })
    ).toBe('audio-m1.mp3');
  });
});

describe('resolvePreviewFile', () => {
  it('uses the media’s expand without a second request', async () => {
    const pb = pbFor(mediaRecord());
    const files = pb.collection('Files') as unknown as { getOne: Stub };
    const file = await resolvePreviewFile(pb, mediaRecord() as never, 'proxy');
    expect(file.id).toBe('f-proxy');
    expect(files.getOne).not.toHaveBeenCalled();
  });

  it('fetches the File when it is not expanded (audio never is)', async () => {
    const audio = previewFile({
      id: 'f-audio',
      name: 'audio.mp3',
      file: 'audio_z.mp3',
      fileType: 'audio',
    });
    const media = mediaRecord({ audioFileRef: 'f-audio' });
    const pb = pbFor(media, [audio]);
    const file = await resolvePreviewFile(pb, media as never, 'audio');
    expect(file.id).toBe('f-audio');
  });

  it('explains a media with no such preview', async () => {
    const media = mediaRecord();
    await expect(
      resolvePreviewFile(pbFor(media), media as never, 'audio')
    ).rejects.toThrow(/vw job transcode -m m1 -a audio/);
  });

  it('refuses a File whose fileType is not the kind it is referenced as', async () => {
    const media = mediaRecord({
      expand: { proxyFileRef: previewFile({ fileType: 'render' }) },
    });
    await expect(
      resolvePreviewFile(pbFor(media), media as never, 'proxy')
    ).rejects.toThrow(/is fileType "render"/);
  });

  it('refuses a File whose bytes are not ready', async () => {
    const media = mediaRecord({
      expand: { proxyFileRef: previewFile({ fileStatus: 'pending' }) },
    });
    await expect(
      resolvePreviewFile(pbFor(media), media as never, 'proxy')
    ).rejects.toThrow(/fileStatus "pending"/);
  });

  it('explains a dangling reference', async () => {
    const media = mediaRecord({ audioFileRef: 'gone', expand: {} });
    await expect(
      resolvePreviewFile(pbFor(media, []), media as never, 'audio')
    ).rejects.toThrow(/no longer exists/);
  });
});

describe('downloadMediaPreview', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vw-download-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('streams the preview to an explicit path', async () => {
    const media = mediaRecord();
    const out = join(dir, 'proxy.mp4');
    const result = await downloadMediaPreview(pbFor(media), {
      mediaId: 'm1',
      kind: 'proxy',
      out,
    });

    expect(result.path).toBe(out);
    expect(result.bytes).toBe(12);
    expect(await readFile(out, 'utf8')).toBe('hello world!');
    expect(result.warnings).toEqual([]);
    expect(result.url).toBe(
      'http://pb.test/api/files/Files/f-proxy/proxy_a1b2c3.mp4'
    );
    expect(result.mediaName).toBe('holiday.mov');
    expect(result.file).toMatchObject({ id: 'f-proxy', size: 12 });
  });

  it('writes the default name into a directory', async () => {
    const result = await downloadMediaPreview(pbFor(mediaRecord()), {
      mediaId: 'm1',
      kind: 'proxy',
      out: dir,
    });
    expect(result.path).toBe(join(dir, 'proxy-m1.mp4'));
    expect(existsSync(result.path as string)).toBe(true);
  });

  it('reports progress against the recorded size', async () => {
    const seen: Array<[number, number]> = [];
    await downloadMediaPreview(pbFor(mediaRecord()), {
      mediaId: 'm1',
      kind: 'proxy',
      out: dir,
      onProgress: (written, expected) => seen.push([written, expected]),
    });
    expect(seen).toEqual([
      [6, 12],
      [12, 12],
    ]);
  });

  it('refuses to overwrite without --force, and fetches nothing', async () => {
    const out = join(dir, 'proxy.mp4');
    await writeFile(out, 'keep me');
    await expect(
      downloadMediaPreview(pbFor(mediaRecord()), {
        mediaId: 'm1',
        kind: 'proxy',
        out,
      })
    ).rejects.toThrow(/pass --force/);
    expect(apiFetch).not.toHaveBeenCalled();
    expect(await readFile(out, 'utf8')).toBe('keep me');
  });

  it('overwrites under --force', async () => {
    const out = join(dir, 'proxy.mp4');
    await writeFile(out, 'stale');
    await downloadMediaPreview(pbFor(mediaRecord()), {
      mediaId: 'm1',
      kind: 'proxy',
      out,
      force: true,
    });
    expect(await readFile(out, 'utf8')).toBe('hello world!');
  });

  it('warns when the bytes written disagree with the File record', async () => {
    const media = mediaRecord({
      expand: { proxyFileRef: previewFile({ size: 99 }) },
    });
    const result = await downloadMediaPreview(pbFor(media), {
      mediaId: 'm1',
      kind: 'proxy',
      out: dir,
    });
    expect(result.bytes).toBe(12);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/records a size of 99/);
  });

  it('removes the partial file when the transfer dies mid-body', async () => {
    failAfterChunk = 1;
    const out = join(dir, 'proxy.mp4');
    await expect(
      downloadMediaPreview(pbFor(mediaRecord()), {
        mediaId: 'm1',
        kind: 'proxy',
        out,
      })
    ).rejects.toThrow(/Download failed for proxy of media m1/);
    // A truncated file that looks complete is worse than no file.
    expect(existsSync(out)).toBe(false);
  });

  it('reports the URL without downloading under --url', async () => {
    const result = await downloadMediaPreview(pbFor(mediaRecord()), {
      mediaId: 'm1',
      kind: 'proxy',
      urlOnly: true,
    });
    expect(result.url).toBe(
      'http://pb.test/api/files/Files/f-proxy/proxy_a1b2c3.mp4'
    );
    expect(result.path).toBeNull();
    expect(result.bytes).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('refuses --url together with an output path', async () => {
    await expect(
      downloadMediaPreview(pbFor(mediaRecord()), {
        mediaId: 'm1',
        kind: 'proxy',
        out: dir,
        urlOnly: true,
      })
    ).rejects.toThrow(/drop -o\/--force/);
  });

  it('explains a File whose bytes live outside PocketBase', async () => {
    const media = mediaRecord({
      expand: { proxyFileRef: previewFile({ file: '', fileSource: 's3' }) },
    });
    await expect(
      downloadMediaPreview(pbFor(media), {
        mediaId: 'm1',
        kind: 'proxy',
        out: dir,
      })
    ).rejects.toThrow(/not hosted in PocketBase/);
  });
});

describe('previewSummaryLines', () => {
  it('leads with where the bytes landed, then the measured facts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-download-'));
    try {
      const result = await downloadMediaPreview(pbFor(mediaRecord()), {
        mediaId: 'm1',
        kind: 'proxy',
        out: join(dir, 'p.mp4'),
      });
      const [headline, facts, url] = previewSummaryLines(result);
      expect(headline).toBe(`proxy of media m1 → ${join(dir, 'p.mp4')}`);
      expect(facts).toContain('holiday.mov');
      expect(facts).toContain('12 B');
      expect(facts).toContain('42.50s');
      expect(facts).toContain('1280x720');
      expect(facts).toContain('30 fps');
      expect(facts).toContain('h264');
      expect(url).toContain('http://pb.test/api/files/Files/f-proxy/');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports audio facts, and needs no third line under --url', async () => {
    const audio = previewFile({
      id: 'f-audio',
      name: 'audio.mp3',
      file: 'audio_z.mp3',
      fileType: 'audio',
      size: 4096,
      meta: {
        mimeType: 'audio/mpeg',
        duration: 42.5,
        channels: 2,
        sampleRate: 48000,
        codec: 'mp3',
      },
    });
    const media = mediaRecord({ audioFileRef: 'f-audio' });
    const result = await downloadMediaPreview(pbFor(media, [audio]), {
      mediaId: 'm1',
      kind: 'audio',
      urlOnly: true,
    });
    const lines = previewSummaryLines(result);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('audio_z.mp3');
    expect(lines[1]).toContain('4.0 KB');
    expect(lines[1]).toContain('2 ch');
    expect(lines[1]).toContain('48000 Hz');
  });
});
