import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LocalStorageBackend } from '../local-backend';
import type { ChunkUploadOptions } from '../types';

/**
 * Chunked-upload semantics of the local backend.
 *
 * The stability invariants under test:
 *  - offset-carrying chunks are POSITIONED writes: they may arrive in any
 *    order (parallel clients) and a retried chunk rewrites its own range
 *    idempotently
 *  - a failed/partial chunk never destroys the rest of the assembled file
 *    (the old behavior unlinked everything, so a client retrying just the
 *    failed chunk silently reassembled a corrupt file)
 *  - finalization verifies the assembled size against the declared size
 *  - offset-less chunks (older clients) still append sequentially
 */

let tmpDir: string;
let backend: LocalStorageBackend;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vw-local-'));
  backend = new LocalStorageBackend({ basePath: tmpDir });
  await backend.initialize();
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

function streamOf(text: string): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

/** A stream that emits some bytes and then errors (simulates a dead client).
 * Errors lazily from pull() so the failure happens mid-consumption, like a
 * real dropped connection, not at construction time. */
function failingStream(prefix: string): ReadableStream {
  let sentPrefix = false;
  return new ReadableStream({
    pull(controller) {
      if (!sentPrefix) {
        sentPrefix = true;
        controller.enqueue(new TextEncoder().encode(prefix));
      } else {
        controller.error(new Error('client connection lost'));
      }
    },
  });
}

function options(partial: Partial<ChunkUploadOptions>): ChunkUploadOptions {
  return {
    chunkIndex: 0,
    totalChunks: 1,
    isFirstChunk: true,
    isLastChunk: true,
    ...partial,
  };
}

async function readAssembled(key: string): Promise<string> {
  return fs.promises.readFile(backend.resolvePath(key), 'utf8');
}

describe('LocalStorageBackend.uploadChunk (positioned writes)', () => {
  const key = 'uploads/ws1/up1/original.mp4';

  it('assembles chunks written out of order', async () => {
    await backend.uploadChunk(
      streamOf('AAAA'),
      key,
      options({
        chunkIndex: 0,
        totalChunks: 3,
        isLastChunk: false,
        offset: 0,
        contentLength: 4,
      })
    );
    // Chunk 2 lands before chunk 1 (parallel middles).
    await backend.uploadChunk(
      streamOf('CC'),
      key,
      options({
        chunkIndex: 2,
        totalChunks: 3,
        isFirstChunk: false,
        isLastChunk: false,
        offset: 8,
        contentLength: 2,
      })
    );
    const final = await backend.uploadChunk(
      streamOf('BBBB'),
      key,
      options({
        chunkIndex: 1,
        totalChunks: 3,
        isFirstChunk: false,
        isLastChunk: true,
        offset: 4,
        contentLength: 4,
        expectedTotalSize: 10,
      })
    );

    expect(await readAssembled(key)).toBe('AAAABBBBCC');
    expect(final.result?.size).toBe(10);
  });

  it('lets a retried chunk rewrite its own range idempotently', async () => {
    await backend.uploadChunk(
      streamOf('AAAA'),
      key,
      options({ totalChunks: 2, isLastChunk: false, offset: 0 })
    );

    // First attempt at chunk 1 dies partway through — the file keeps
    // whatever bytes made it, and chunk 0 is untouched.
    await expect(
      backend.uploadChunk(
        failingStream('BB'),
        key,
        options({
          chunkIndex: 1,
          totalChunks: 2,
          isFirstChunk: false,
          isLastChunk: true,
          offset: 4,
        })
      )
    ).rejects.toThrow(/connection lost/);
    expect((await readAssembled(key)).startsWith('AAAA')).toBe(true);

    // The retry rewrites the same range and finalizes cleanly.
    const final = await backend.uploadChunk(
      streamOf('BBBB'),
      key,
      options({
        chunkIndex: 1,
        totalChunks: 2,
        isFirstChunk: false,
        isLastChunk: true,
        offset: 4,
        expectedTotalSize: 8,
      })
    );
    expect(await readAssembled(key)).toBe('AAAABBBB');
    expect(final.result?.size).toBe(8);
  });

  it('rejects finalization when the assembled size does not match', async () => {
    await backend.uploadChunk(
      streamOf('AAAA'),
      key,
      options({ totalChunks: 2, isLastChunk: false, offset: 0 })
    );
    await expect(
      backend.uploadChunk(
        streamOf('BB'),
        key,
        options({
          chunkIndex: 1,
          totalChunks: 2,
          isFirstChunk: false,
          isLastChunk: true,
          offset: 4,
          expectedTotalSize: 999,
        })
      )
    ).rejects.toThrow(/999 bytes were expected/);
  });

  it('rejects a positioned non-first chunk when the file was never created', async () => {
    await expect(
      backend.uploadChunk(
        streamOf('BBBB'),
        key,
        options({
          chunkIndex: 1,
          totalChunks: 2,
          isFirstChunk: false,
          isLastChunk: true,
          offset: 4,
        })
      )
    ).rejects.toThrow(/Failed to upload chunk 2\/2/);
  });

  it('truncates stale bytes when the first chunk restarts an upload', async () => {
    await backend.uploadChunk(
      streamOf('OLD-CONTENT-LONG'),
      key,
      options({ contentLength: 16 })
    );
    const final = await backend.uploadChunk(
      streamOf('NEW'),
      key,
      options({ offset: 0, contentLength: 3, expectedTotalSize: 3 })
    );
    expect(await readAssembled(key)).toBe('NEW');
    expect(final.result?.size).toBe(3);
  });
});

describe('LocalStorageBackend.uploadChunk (sequential append fallback)', () => {
  const key = 'uploads/ws1/up2/original.mp4';

  it('appends offset-less chunks in order', async () => {
    await backend.uploadChunk(
      streamOf('AAAA'),
      key,
      options({ totalChunks: 2, isLastChunk: false })
    );
    const final = await backend.uploadChunk(
      streamOf('BB'),
      key,
      options({
        chunkIndex: 1,
        totalChunks: 2,
        isFirstChunk: false,
        isLastChunk: true,
        expectedTotalSize: 6,
      })
    );
    expect(await readAssembled(key)).toBe('AAAABB');
    expect(final.result?.size).toBe(6);
  });

  it('rolls a failed append back so the retry appends cleanly', async () => {
    await backend.uploadChunk(
      streamOf('AAAA'),
      key,
      options({ totalChunks: 2, isLastChunk: false })
    );

    // Partial append dies; the file must roll back to the pre-append length
    // (the old behavior deleted the whole file, so the retry rebuilt a file
    // missing chunk 0).
    await expect(
      backend.uploadChunk(
        failingStream('BB'),
        key,
        options({
          chunkIndex: 1,
          totalChunks: 2,
          isFirstChunk: false,
          isLastChunk: true,
        })
      )
    ).rejects.toThrow(/connection lost/);
    expect(await readAssembled(key)).toBe('AAAA');

    const final = await backend.uploadChunk(
      streamOf('BBBB'),
      key,
      options({
        chunkIndex: 1,
        totalChunks: 2,
        isFirstChunk: false,
        isLastChunk: true,
        expectedTotalSize: 8,
      })
    );
    expect(await readAssembled(key)).toBe('AAAABBBB');
    expect(final.result?.size).toBe(8);
  });
});
