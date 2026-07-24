import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaType, UploadStatus, type Upload } from '@project/shared';
import {
  chunkPlan,
  describeNetworkError,
  formatBytes,
  listUploads,
  mediaByUpload,
  mediaTypeForFile,
  parseUploadStatus,
  replaceUploadFile,
  resolveAppUrl,
  resolveReplaceTarget,
  uploadFile,
  validateReplacementFile,
  validateUploadFile,
} from '../lib/upload.js';
import { fakePb, listResult } from './fake-pb.js';

// The real module pins undici agents to HTTP/1.1; in tests, chunk PUTs
// delegate to the stubbed global fetch so assertions stay on fetchMock,
// and connection resets are observable via the spy.
const { resetConnectionsSpy } = vi.hoisted(() => ({
  resetConnectionsSpy: vi.fn(),
}));
vi.mock('../lib/http.js', () => ({
  uploadFetch: (url: string, init: RequestInit): Promise<Response> =>
    globalThis.fetch(url, init),
  apiFetch: (url: RequestInfo | URL, config?: RequestInit): Promise<Response> =>
    globalThis.fetch(url, config),
  resetUploadConnections: resetConnectionsSpy,
}));

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'vw-upload-'));
  resetConnectionsSpy.mockClear();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(tmpDir, { recursive: true, force: true });
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('chunkPlan', () => {
  it('splits a size into full chunks plus a short tail', () => {
    expect(chunkPlan(250, 100)).toEqual([
      { index: 0, start: 0, length: 100 },
      { index: 1, start: 100, length: 100 },
      { index: 2, start: 200, length: 50 },
    ]);
  });

  it('handles exact multiples without an empty tail chunk', () => {
    expect(chunkPlan(200, 100)).toHaveLength(2);
    expect(chunkPlan(200, 100)[1]).toEqual({
      index: 1,
      start: 100,
      length: 100,
    });
  });

  it('uses a single chunk when the file is smaller than the chunk size', () => {
    expect(chunkPlan(42, 100)).toEqual([{ index: 0, start: 0, length: 42 }]);
  });
});

describe('formatBytes', () => {
  it('formats byte counts with a sensible unit', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(100 * 1024 * 1024)).toBe('100 MB');
    expect(formatBytes(1.2 * 1024 * 1024 * 1024)).toBe('1.2 GB');
  });
});

describe('resolveAppUrl', () => {
  it('prefers the explicit override and strips trailing slashes', () => {
    expect(resolveAppUrl('https://example.com/')).toBe('https://example.com');
  });
});

describe('validateUploadFile', () => {
  it('rejects a missing file', async () => {
    await expect(validateUploadFile(join(tmpDir, 'nope.mp4'))).rejects.toThrow(
      /not found/i
    );
  });

  it('rejects an empty file', async () => {
    const file = join(tmpDir, 'empty.mp4');
    await writeFile(file, '');
    await expect(validateUploadFile(file)).rejects.toThrow(/empty/i);
  });

  it('rejects unknown and missing extensions', async () => {
    const weird = join(tmpDir, 'movie.xyz');
    await writeFile(weird, 'data');
    await expect(validateUploadFile(weird)).rejects.toThrow(
      /unsupported file type/i
    );

    const bare = join(tmpDir, 'movie');
    await writeFile(bare, 'data');
    await expect(validateUploadFile(bare)).rejects.toThrow(
      /unsupported file type/i
    );
  });

  it('returns basename and size for a valid file', async () => {
    const file = join(tmpDir, 'clip.MP4');
    await writeFile(file, 'x'.repeat(25));
    await expect(validateUploadFile(file)).resolves.toEqual({
      name: 'clip.MP4',
      size: 25,
    });
  });
});

describe('uploadFile', () => {
  async function makeFile(bytes = 25): Promise<string> {
    const file = join(tmpDir, 'clip.mp4');
    await writeFile(file, 'x'.repeat(bytes));
    return file;
  }

  function uploadsStub() {
    return {
      create: vi.fn(async (data: Record<string, unknown>) => ({
        ...data,
        id: 'up1',
      })),
      update: vi.fn(async (id: string, data: Record<string, unknown>) => ({
        ...data,
        id,
      })),
    };
  }

  it('creates the record and PUTs every chunk with the webapp protocol headers', async () => {
    const file = await makeFile(25);
    const uploads = uploadsStub();
    const pb = fakePb({ Uploads: uploads });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { complete: false }))
      .mockResolvedValueOnce(jsonResponse(200, { complete: false }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          complete: true,
          upload: { id: 'up1', status: 'uploaded' },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const progress: number[] = [];
    const result = await uploadFile(pb, {
      filePath: file,
      workspaceId: 'ws1',
      appUrl: 'http://app.test',
      directoryId: 'dir1',
      chunkSize: 10,
      onProgress: (p) => progress.push(p.bytesUploaded),
    });

    expect(result).toEqual({ id: 'up1', status: 'uploaded' });
    expect(uploads.create).toHaveBeenCalledOnce();
    expect(uploads.create.mock.calls[0][0]).toMatchObject({
      name: 'clip.mp4',
      size: 25,
      status: 'queued',
      bytesUploaded: 0,
      WorkspaceRef: 'ws1',
      UserRef: 'user1',
      DirectoryRef: 'dir1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://app.test/api-next/uploads/upload');
    expect(init.method).toBe('PUT');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'x-upload-id': 'up1',
      'x-workspace-id': 'ws1',
      'x-user-id': 'user1',
      'x-file-name': 'clip.mp4',
      'x-chunk-index': '0',
      'x-total-chunks': '3',
      'x-chunk-size': '10',
      'x-directory-id': 'dir1',
    });
    const bodySizes = fetchMock.mock.calls.map(
      (call) => ((call as [string, RequestInit])[1].body as Uint8Array).length
    );
    expect(bodySizes).toEqual([10, 10, 5]);
    const lastHeaders = (fetchMock.mock.calls[2] as [string, RequestInit])[1]
      .headers as Record<string, string>;
    expect(lastHeaders['x-chunk-index']).toBe('2');
    expect(lastHeaders['x-chunk-size']).toBe('5');
    expect(progress).toEqual([10, 20, 25]);
  });

  it('retries a chunk on network errors and 5xx, then succeeds', async () => {
    const file = await makeFile(25);
    const uploads = uploadsStub();
    const pb = fakePb({ Uploads: uploads });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(jsonResponse(500, { error: 'storage hiccup' }))
      .mockResolvedValueOnce(jsonResponse(200, { complete: false }))
      .mockResolvedValueOnce(jsonResponse(200, { complete: false }))
      .mockResolvedValueOnce(
        jsonResponse(200, { complete: true, upload: { id: 'up1' } })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      uploadFile(pb, {
        filePath: file,
        workspaceId: 'ws1',
        appUrl: 'http://app.test',
        chunkSize: 10,
        backoffBaseMs: 0,
      })
    ).resolves.toEqual({ id: 'up1' });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(uploads.update).not.toHaveBeenCalled();
    // Each retry starts on a fresh connection (two failures → two resets).
    expect(resetConnectionsSpy).toHaveBeenCalledTimes(2);
  });

  it('retries 429 rate-limit responses', async () => {
    const file = await makeFile(5);
    const uploads = uploadsStub();
    const pb = fakePb({ Uploads: uploads });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: 'slow down' }))
      .mockResolvedValueOnce(
        jsonResponse(200, { complete: true, upload: { id: 'up1' } })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      uploadFile(pb, {
        filePath: file,
        workspaceId: 'ws1',
        appUrl: 'http://app.test',
        chunkSize: 10,
        backoffBaseMs: 0,
      })
    ).resolves.toEqual({ id: 'up1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(uploads.update).not.toHaveBeenCalled();
  });

  it('surfaces the fetch failure cause chain in the final error', async () => {
    const file = await makeFile(5);
    const uploads = uploadsStub();
    const pb = fakePb({ Uploads: uploads });
    const streamError = Object.assign(
      new Error('Stream closed with error code NGHTTP2_ENHANCE_YOUR_CALM'),
      { code: 'ERR_HTTP2_STREAM_ERROR' }
    );
    const fetchMock = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new TypeError('fetch failed'), { cause: streamError })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      uploadFile(pb, {
        filePath: file,
        workspaceId: 'ws1',
        appUrl: 'http://app.test',
        chunkSize: 10,
        maxRetries: 1,
        backoffBaseMs: 0,
      })
    ).rejects.toThrow(/NGHTTP2_ENHANCE_YOUR_CALM.*ERR_HTTP2_STREAM_ERROR/);
  });

  it('marks the record failed and throws when retries are exhausted', async () => {
    const file = await makeFile(25);
    const uploads = uploadsStub();
    const pb = fakePb({ Uploads: uploads });
    const fetchMock = vi.fn().mockRejectedValue(new Error('socket hang up'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      uploadFile(pb, {
        filePath: file,
        workspaceId: 'ws1',
        appUrl: 'http://app.test',
        chunkSize: 10,
        maxRetries: 2,
        backoffBaseMs: 0,
      })
    ).rejects.toThrow(/chunk 1\/3/i);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(uploads.update).toHaveBeenCalledOnce();
    expect(uploads.update.mock.calls[0][1]).toMatchObject({
      status: 'failed',
    });
  });

  it('fails fast on 4xx responses without retrying', async () => {
    const file = await makeFile(25);
    const uploads = uploadsStub();
    const pb = fakePb({ Uploads: uploads });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(403, { error: 'Workspace mismatch' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      uploadFile(pb, {
        filePath: file,
        workspaceId: 'ws1',
        appUrl: 'http://app.test',
        chunkSize: 10,
        backoffBaseMs: 0,
      })
    ).rejects.toThrow(/workspace mismatch/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(uploads.update.mock.calls[0][1]).toMatchObject({
      status: 'failed',
    });
  });

  it('sends offset/total-size headers and threads the multipart id', async () => {
    const file = await makeFile(25);
    const uploads = uploadsStub();
    const pb = fakePb({ Uploads: uploads });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { complete: false, multipartUploadId: 'mp-1' })
      )
      .mockResolvedValueOnce(jsonResponse(200, { complete: false }))
      .mockResolvedValueOnce(
        jsonResponse(200, { complete: true, upload: { id: 'up1' } })
      );
    vi.stubGlobal('fetch', fetchMock);

    await uploadFile(pb, {
      filePath: file,
      workspaceId: 'ws1',
      appUrl: 'http://app.test',
      chunkSize: 10,
    });

    const headersOf = (i: number) =>
      (fetchMock.mock.calls[i] as [string, RequestInit])[1].headers as Record<
        string,
        string
      >;
    expect(headersOf(0)).toMatchObject({
      'x-chunk-index': '0',
      'x-chunk-offset': '0',
      'x-total-size': '25',
    });
    // The first chunk cannot know the id — the server mints it.
    expect(headersOf(0)).not.toHaveProperty('x-multipart-upload-id');
    expect(headersOf(1)).toMatchObject({
      'x-chunk-offset': '10',
      'x-multipart-upload-id': 'mp-1',
    });
    expect(headersOf(2)).toMatchObject({
      'x-chunk-offset': '20',
      'x-multipart-upload-id': 'mp-1',
    });
  });

  it('uploads middle chunks in parallel between a lone first and last chunk', async () => {
    const file = join(tmpDir, 'clip.mp4');
    await writeFile(file, 'x'.repeat(50)); // chunkSize 10 → chunks 0..4
    const uploads = uploadsStub();
    const pb = fakePb({ Uploads: uploads });

    const started: string[] = [];
    const resolvers = new Map<string, (r: Response) => void>();
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit): Promise<Response> => {
        const index = (init.headers as Record<string, string>)['x-chunk-index'];
        started.push(index);
        return new Promise<Response>((resolve) => {
          resolvers.set(index, resolve);
        });
      }
    );
    vi.stubGlobal('fetch', fetchMock);
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

    const run = uploadFile(pb, {
      filePath: file,
      workspaceId: 'ws1',
      appUrl: 'http://app.test',
      chunkSize: 10,
      concurrency: 3,
    });

    // Chunk 0 goes alone.
    await tick();
    expect(started).toEqual(['0']);
    resolvers.get('0')!(jsonResponse(200, { complete: false }));

    // All three middles go out together; the finalizer must wait.
    await tick();
    expect([...started].sort()).toEqual(['0', '1', '2', '3']);
    for (const index of ['1', '2', '3']) {
      resolvers.get(index)!(jsonResponse(200, { complete: false }));
    }

    // Only after every middle resolved does the last chunk go out.
    await tick();
    expect(started).toHaveLength(5);
    expect(started[4]).toBe('4');
    resolvers.get('4')!(
      jsonResponse(200, { complete: true, upload: { id: 'up1' } })
    );

    await expect(run).resolves.toEqual({ id: 'up1' });
  });

  it('stops early when the route reports the upload already complete', async () => {
    const file = await makeFile(25);
    const uploads = uploadsStub();
    const pb = fakePb({ Uploads: uploads });
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        complete: true,
        upload: { id: 'up1', status: 'uploaded' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      uploadFile(pb, {
        filePath: file,
        workspaceId: 'ws1',
        appUrl: 'http://app.test',
        chunkSize: 10,
      })
    ).resolves.toEqual({ id: 'up1', status: 'uploaded' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('mediaTypeForFile', () => {
  it('maps extensions to the media type ingest would assign', () => {
    expect(mediaTypeForFile('clip.MP4')).toBe('video');
    expect(mediaTypeForFile('song.flac')).toBe('audio');
    expect(mediaTypeForFile('photo.jpeg')).toBe('image');
    expect(mediaTypeForFile('data.xyz')).toBeUndefined();
    expect(mediaTypeForFile('noext')).toBeUndefined();
  });
});

describe('resolveReplaceTarget', () => {
  const notFound = Object.assign(new Error('not found'), { status: 404 });
  const storedUpload = {
    id: 'up1',
    name: 'old.mp4',
    size: 1000,
    WorkspaceRef: 'ws1',
    externalPath: 'uploads/ws1/up1/original.mp4',
  };

  it('resolves a media id to the media and its expanded source upload', async () => {
    const getOne = vi.fn(async () => ({
      id: 'm1',
      UploadRef: 'up1',
      mediaType: 'video',
      expand: { UploadRef: storedUpload },
    }));
    const pb = fakePb({ Media: { getOne } });

    await expect(resolveReplaceTarget(pb, 'm1')).resolves.toMatchObject({
      media: { id: 'm1' },
      upload: { id: 'up1', externalPath: 'uploads/ws1/up1/original.mp4' },
      resolvedBy: 'media',
    });
  });

  it('resolves an upload id when no media has that id', async () => {
    // Not a media id → falls back to an upload lookup; the media ingested
    // from that upload is found for the type-match rule and the report.
    const pb = fakePb({
      Media: {
        getOne: vi.fn().mockRejectedValue(notFound),
        getFirstListItem: vi.fn(async () => ({ id: 'm1', mediaType: 'video' })),
      },
      Uploads: { getOne: vi.fn(async () => storedUpload) },
    });

    await expect(resolveReplaceTarget(pb, 'up1')).resolves.toMatchObject({
      media: { id: 'm1' },
      upload: { id: 'up1' },
      resolvedBy: 'upload',
    });
  });

  it('resolves an upload id even when nothing has ingested from it yet', async () => {
    const pb = fakePb({
      Media: {
        getOne: vi.fn().mockRejectedValue(notFound),
        getFirstListItem: vi.fn().mockRejectedValue(notFound),
      },
      Uploads: { getOne: vi.fn(async () => storedUpload) },
    });
    await expect(resolveReplaceTarget(pb, 'up1')).resolves.toMatchObject({
      media: null,
      upload: { id: 'up1' },
      resolvedBy: 'upload',
    });
  });

  it('rejects when the id is neither a media nor an upload', async () => {
    const pb = fakePb({
      Media: { getOne: vi.fn().mockRejectedValue(notFound) },
      Uploads: { getOne: vi.fn().mockRejectedValue(notFound) },
    });
    await expect(resolveReplaceTarget(pb, 'nope')).rejects.toThrow(
      /no media or upload found/i
    );
  });

  it('rejects when the resolved upload has no stored original', async () => {
    const getOne = vi.fn(async () => ({
      id: 'm1',
      UploadRef: 'up1',
      mediaType: 'video',
      expand: {
        UploadRef: { id: 'up1', name: 'old.mp4', WorkspaceRef: 'ws1' },
      },
    }));
    const pb = fakePb({ Media: { getOne } });
    await expect(resolveReplaceTarget(pb, 'm1')).rejects.toThrow(
      /no stored original/i
    );
  });
});

describe('validateReplacementFile', () => {
  it('accepts a file of the same media type (extension may differ)', async () => {
    const file = join(tmpDir, 'regrade.webm');
    await writeFile(file, 'x'.repeat(10));
    await expect(
      validateReplacementFile(file, MediaType.VIDEO)
    ).resolves.toEqual({ name: 'regrade.webm', size: 10 });
  });

  it('rejects a replacement of a different media type', async () => {
    const file = join(tmpDir, 'photo.png');
    await writeFile(file, 'x');
    await expect(
      validateReplacementFile(file, MediaType.VIDEO)
    ).rejects.toThrow(/must be a video file/i);
  });

  it('skips the type check when the expected type is unknown', async () => {
    // Replacing an upload with no ingested media and an unrecognised original
    // extension: the file itself is still validated, but no type is enforced.
    const file = join(tmpDir, 'photo.png');
    await writeFile(file, 'x');
    await expect(validateReplacementFile(file, undefined)).resolves.toEqual({
      name: 'photo.png',
      size: 1,
    });
  });
});

describe('replaceUploadFile', () => {
  const upload = {
    id: 'up1',
    name: 'old.mp4',
    WorkspaceRef: 'ws1',
    externalPath: 'uploads/ws1/up1/original.mp4',
  } as unknown as Upload;

  async function makeFile(bytes = 25): Promise<string> {
    const file = join(tmpDir, 'clip.mp4');
    await writeFile(file, 'x'.repeat(bytes));
    return file;
  }

  it('PUTs every chunk to the replace route without touching any record', async () => {
    const file = await makeFile(25);
    // No collections stubbed: any record read/write would throw.
    const pb = fakePb({});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { complete: false }))
      .mockResolvedValueOnce(jsonResponse(200, { complete: false }))
      .mockResolvedValueOnce(jsonResponse(200, { complete: true }));
    vi.stubGlobal('fetch', fetchMock);

    const progress: number[] = [];
    await replaceUploadFile(pb, {
      filePath: file,
      upload,
      appUrl: 'http://app.test',
      chunkSize: 10,
      onProgress: (p) => progress.push(p.bytesUploaded),
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://app.test/api-next/uploads/replace');
    expect(init.method).toBe('PUT');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'x-upload-id': 'up1',
      'x-workspace-id': 'ws1',
      'x-user-id': 'user1',
      'x-file-name': 'clip.mp4',
      'x-chunk-index': '0',
      'x-total-chunks': '3',
    });
    expect(init.headers).not.toHaveProperty('x-directory-id');
    expect(progress).toEqual([10, 20, 25]);
  });

  it('throws without marking anything when retries are exhausted', async () => {
    const file = await makeFile(25);
    const pb = fakePb({});
    const fetchMock = vi.fn().mockRejectedValue(new Error('socket hang up'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      replaceUploadFile(pb, {
        filePath: file,
        upload,
        appUrl: 'http://app.test',
        chunkSize: 10,
        maxRetries: 2,
        backoffBaseMs: 0,
      })
    ).rejects.toThrow(/chunk 1\/3/i);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('fails fast on 4xx responses without retrying', async () => {
    const file = await makeFile(25);
    const pb = fakePb({});
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(400, {
        error: 'This media has no stored original file to replace.',
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      replaceUploadFile(pb, {
        filePath: file,
        upload,
        appUrl: 'http://app.test',
        chunkSize: 10,
        backoffBaseMs: 0,
      })
    ).rejects.toThrow(/no stored original/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('describeNetworkError', () => {
  it('flattens the cause chain with error codes', () => {
    const inner = Object.assign(
      new Error('Stream closed with error code NGHTTP2_ENHANCE_YOUR_CALM'),
      { code: 'ERR_HTTP2_STREAM_ERROR' }
    );
    const outer = Object.assign(new TypeError('fetch failed'), {
      cause: inner,
    });
    expect(describeNetworkError(outer)).toBe(
      'fetch failed: Stream closed with error code ' +
        'NGHTTP2_ENHANCE_YOUR_CALM [ERR_HTTP2_STREAM_ERROR]'
    );
  });

  it('handles plain errors and non-errors', () => {
    expect(describeNetworkError(new Error('socket hang up'))).toBe(
      'socket hang up'
    );
    expect(describeNetworkError('boom')).toBe('boom');
  });
});

describe('parseUploadStatus', () => {
  it('accepts a valid status', () => {
    expect(parseUploadStatus('uploaded')).toBe(UploadStatus.UPLOADED);
  });

  it('rejects an unknown status', () => {
    expect(() => parseUploadStatus('done')).toThrow(/invalid upload status/i);
  });
});

describe('listUploads', () => {
  it('lists a workspace newest-first with no status filter', async () => {
    const getList = vi.fn(
      async (_page: number, _perPage: number, _opts: { filter?: string }) =>
        listResult([{ id: 'up1', name: 'a.mp4' }])
    );
    const pb = fakePb({ Uploads: { getList } });

    const result = await listUploads(pb, 'ws1');

    expect(result.items).toEqual([{ id: 'up1', name: 'a.mp4' }]);
    const [page, perPage, options] = getList.mock.calls[0];
    expect(page).toBe(1);
    expect(perPage).toBe(200);
    expect(options.filter).toBe('WorkspaceRef = ws1');
  });

  it('narrows to a status and honours the limit', async () => {
    const getList = vi.fn(
      async (_page: number, _perPage: number, _opts: { filter?: string }) =>
        listResult([])
    );
    const pb = fakePb({ Uploads: { getList } });

    await listUploads(pb, 'ws1', { status: UploadStatus.FAILED, limit: 5 });

    const [, perPage, options] = getList.mock.calls[0];
    expect(perPage).toBe(5);
    expect(options.filter).toBe('WorkspaceRef = ws1 && status = failed');
  });
});

describe('mediaByUpload', () => {
  it('maps each upload id to the media ingested from it', async () => {
    const getList = vi.fn(async () =>
      listResult([
        { id: 'm1', UploadRef: 'up1' },
        { id: 'm2', UploadRef: 'up2' },
        { id: 'm3' }, // no source upload — skipped
      ])
    );
    const pb = fakePb({ Media: { getList } });

    const map = await mediaByUpload(pb, 'ws1');

    expect(map.get('up1')?.id).toBe('m1');
    expect(map.get('up2')?.id).toBe('m2');
    expect(map.size).toBe(2);
  });
});
