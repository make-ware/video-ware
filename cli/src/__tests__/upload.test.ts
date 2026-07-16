import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chunkPlan,
  formatBytes,
  pollUploadIngest,
  resolveAppUrl,
  uploadFile,
  validateUploadFile,
} from '../lib/upload.js';
import { fakePb, listResult } from './fake-pb.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'vw-upload-'));
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

describe('pollUploadIngest', () => {
  const notFound = Object.assign(new Error('not found'), { status: 404 });

  it('resolves with the media once it becomes active, deduping stages', async () => {
    const getOne = vi.fn(async () => ({ id: 'up1', status: 'uploaded' }));
    const getList = vi.fn(async () => listResult([]));
    const getFirstListItem = vi
      .fn()
      .mockRejectedValueOnce(notFound)
      .mockRejectedValueOnce(notFound)
      .mockResolvedValueOnce({ id: 'm1', isActive: false })
      .mockResolvedValueOnce({ id: 'm1', isActive: true });
    const pb = fakePb({
      Uploads: { getOne },
      Media: { getFirstListItem },
      Tasks: { getList },
    });

    const stages: string[] = [];
    const media = await pollUploadIngest(pb, 'up1', {
      intervalMs: 0,
      onUpdate: (stage) => stages.push(stage),
    });

    expect(media).toEqual({ id: 'm1', isActive: true });
    expect(stages).toEqual([
      'uploaded — waiting for ingest',
      'processing — media m1, proxy pending',
    ]);
  });

  it('rejects when the upload record is marked failed', async () => {
    const pb = fakePb({
      Uploads: {
        getOne: vi.fn(async () => ({
          id: 'up1',
          status: 'failed',
          errorMessage: 'boom',
        })),
      },
      Media: { getFirstListItem: vi.fn() },
      Tasks: { getList: vi.fn() },
    });

    await expect(
      pollUploadIngest(pb, 'up1', { intervalMs: 0 })
    ).rejects.toThrow('boom');
  });

  it('rejects when an ingest task failed', async () => {
    const pb = fakePb({
      Uploads: {
        getOne: vi.fn(async () => ({ id: 'up1', status: 'uploaded' })),
      },
      Media: { getFirstListItem: vi.fn() },
      Tasks: {
        getList: vi.fn(async () =>
          listResult([
            { type: 'process_upload', status: 'failed', errorLog: 'ffmpeg' },
          ])
        ),
      },
    });

    await expect(
      pollUploadIngest(pb, 'up1', { intervalMs: 0 })
    ).rejects.toThrow(/process_upload failed: ffmpeg/i);
  });

  it('rejects when the deadline passes before the media is active', async () => {
    const pb = fakePb({
      Uploads: {
        getOne: vi.fn(async () => ({ id: 'up1', status: 'uploaded' })),
      },
      Media: { getFirstListItem: vi.fn().mockRejectedValue(notFound) },
      Tasks: { getList: vi.fn(async () => listResult([])) },
    });

    await expect(
      pollUploadIngest(pb, 'up1', { intervalMs: 2, maxWaitMs: 1 })
    ).rejects.toThrow(/timed out/i);
  });
});
