import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { S3StorageBackend } from '../s3-backend';
import type { ChunkUploadOptions } from '../types';

/**
 * Chunked-upload semantics of the S3 backend, with the SDK client mocked at
 * S3Client.prototype.send.
 *
 * The invariants under test:
 *  - single-chunk files use ONE streaming PutObject (no multipart round trips)
 *  - chunks with a known length are streamed (Node Readable body +
 *    ContentLength), not buffered
 *  - the multipart upload id is stateless server-side: taken from the
 *    client-echoed option, or rediscovered via ListMultipartUploads
 *  - finalization reads part ETags back via ListParts (works no matter which
 *    process handled which chunk), checks the part count, and verifies the
 *    assembled size
 *  - a retried first chunk aborts the dangling prior multipart upload
 */

interface SentCommand {
  name: string;
  input: Record<string, unknown>;
}

let sent: SentCommand[];
let handlers: Record<
  string,
  (input: Record<string, unknown>) => Record<string, unknown>
>;

function commandNames(): string[] {
  return sent.map((c) => c.name);
}

function backend(): S3StorageBackend {
  return new S3StorageBackend({
    endpoint: 'http://s3.test',
    bucket: 'media',
    region: 'garage',
    accessKeyId: 'k',
    secretAccessKey: 's',
    forcePathStyle: true,
  });
}

function streamOf(text: string): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
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

beforeEach(() => {
  sent = [];
  handlers = {};
  vi.spyOn(S3Client.prototype, 'send').mockImplementation(
    async (command: any) => {
      const name = String(command.constructor.name);
      const input = command.input as Record<string, unknown>;
      sent.push({ name, input });
      const handler = handlers[name];
      if (!handler) {
        throw new Error(`No mock handler for ${name}`);
      }
      return handler(input);
    }
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('S3StorageBackend.uploadChunk (single chunk fast path)', () => {
  it('uses one streaming PutObject and skips the multipart API', async () => {
    handlers.PutObjectCommand = () => ({ ETag: '"abc"' });

    const result = await backend().uploadChunk(
      streamOf('DATA'),
      'uploads/ws/s3-single/original.mp4',
      options({ contentLength: 4, expectedTotalSize: 4 })
    );

    expect(commandNames()).toEqual(['PutObjectCommand']);
    expect(sent[0].input.ContentLength).toBe(4);
    // Known length → the body streams through instead of being buffered.
    expect(sent[0].input.Body).toBeInstanceOf(Readable);
    expect(result.result).toMatchObject({
      path: 'uploads/ws/s3-single/original.mp4',
      size: 4,
      etag: 'abc',
    });
  });

  it('rejects before uploading when the chunk cannot be the declared size', async () => {
    await expect(
      backend().uploadChunk(
        streamOf('DATA'),
        'uploads/ws/s3-single-bad/original.mp4',
        options({ contentLength: 4, expectedTotalSize: 999 })
      )
    ).rejects.toThrow(/declared as 999 bytes/);
    expect(sent).toHaveLength(0);
  });

  it('buffers the body when no length is known', async () => {
    handlers.PutObjectCommand = () => ({ ETag: '"abc"' });

    const result = await backend().uploadChunk(
      streamOf('DATA'),
      'uploads/ws/s3-single-nolen/original.mp4',
      options({})
    );

    expect(sent[0].input.Body).toBeInstanceOf(Buffer);
    expect(sent[0].input.ContentLength).toBe(4);
    expect(result.result?.size).toBe(4);
  });
});

describe('S3StorageBackend.uploadChunk (multipart)', () => {
  it('opens the multipart upload on the first chunk and returns its id', async () => {
    handlers.ListMultipartUploadsCommand = () => ({ Uploads: [] });
    handlers.CreateMultipartUploadCommand = () => ({ UploadId: 'mp-1' });
    handlers.UploadPartCommand = () => ({ ETag: '"p1"' });

    const result = await backend().uploadChunk(
      streamOf('AAAA'),
      'uploads/ws/s3-first/original.mp4',
      options({
        totalChunks: 3,
        isLastChunk: false,
        contentLength: 4,
      })
    );

    expect(commandNames()).toEqual([
      'ListMultipartUploadsCommand',
      'CreateMultipartUploadCommand',
      'UploadPartCommand',
    ]);
    expect(sent[2].input).toMatchObject({
      UploadId: 'mp-1',
      PartNumber: 1,
      ContentLength: 4,
    });
    expect(sent[2].input.Body).toBeInstanceOf(Readable);
    expect(result).toEqual({ multipartUploadId: 'mp-1' });
  });

  it('aborts a dangling prior upload when the first chunk restarts', async () => {
    handlers.ListMultipartUploadsCommand = () => ({
      Uploads: [{ Key: 'uploads/ws/s3-restart/original.mp4', UploadId: 'old' }],
    });
    handlers.AbortMultipartUploadCommand = () => ({});
    handlers.CreateMultipartUploadCommand = () => ({ UploadId: 'mp-2' });
    handlers.UploadPartCommand = () => ({ ETag: '"p1"' });

    await backend().uploadChunk(
      streamOf('AAAA'),
      'uploads/ws/s3-restart/original.mp4',
      options({ totalChunks: 2, isLastChunk: false, contentLength: 4 })
    );

    expect(commandNames()).toContain('AbortMultipartUploadCommand');
    const abort = sent.find((c) => c.name === 'AbortMultipartUploadCommand');
    expect(abort?.input.UploadId).toBe('old');
  });

  it('uses the client-echoed upload id for middle chunks without discovery', async () => {
    handlers.UploadPartCommand = () => ({ ETag: '"p2"' });

    const result = await backend().uploadChunk(
      streamOf('BBBB'),
      'uploads/ws/s3-middle/original.mp4',
      options({
        chunkIndex: 1,
        totalChunks: 3,
        isFirstChunk: false,
        isLastChunk: false,
        contentLength: 4,
        multipartUploadId: 'mp-echoed',
      })
    );

    expect(commandNames()).toEqual(['UploadPartCommand']);
    expect(sent[0].input).toMatchObject({
      UploadId: 'mp-echoed',
      PartNumber: 2,
    });
    expect(result).toEqual({ multipartUploadId: 'mp-echoed' });
  });

  it('rediscovers the upload id from S3 when neither client nor cache has it', async () => {
    handlers.ListMultipartUploadsCommand = () => ({
      Uploads: [
        {
          Key: 'uploads/ws/s3-discover/original.mp4',
          UploadId: 'mp-old',
          Initiated: new Date('2026-01-01'),
        },
        {
          Key: 'uploads/ws/s3-discover/original.mp4',
          UploadId: 'mp-new',
          Initiated: new Date('2026-06-01'),
        },
        // Different key sharing the prefix — must be ignored.
        {
          Key: 'uploads/ws/s3-discover/original.mp4.replacing',
          UploadId: 'mp-other',
          Initiated: new Date('2026-07-01'),
        },
      ],
    });
    handlers.UploadPartCommand = () => ({ ETag: '"p2"' });

    await backend().uploadChunk(
      streamOf('BBBB'),
      'uploads/ws/s3-discover/original.mp4',
      options({
        chunkIndex: 1,
        totalChunks: 3,
        isFirstChunk: false,
        isLastChunk: false,
        contentLength: 4,
      })
    );

    const part = sent.find((c) => c.name === 'UploadPartCommand');
    expect(part?.input.UploadId).toBe('mp-new');
  });

  it('finalizes via ListParts + Complete and verifies the assembled size', async () => {
    handlers.UploadPartCommand = () => ({ ETag: '"p3"' });
    handlers.ListPartsCommand = () => ({
      Parts: [
        { PartNumber: 3, ETag: '"p3"' },
        { PartNumber: 1, ETag: '"p1"' },
        { PartNumber: 2, ETag: '"p2"' },
      ],
    });
    handlers.CompleteMultipartUploadCommand = () => ({});
    handlers.HeadObjectCommand = () => ({
      ContentLength: 10,
      ETag: '"final"',
    });

    const result = await backend().uploadChunk(
      streamOf('CC'),
      'uploads/ws/s3-final/original.mp4',
      options({
        chunkIndex: 2,
        totalChunks: 3,
        isFirstChunk: false,
        isLastChunk: true,
        contentLength: 2,
        expectedTotalSize: 10,
        multipartUploadId: 'mp-3',
      })
    );

    expect(commandNames()).toEqual([
      'UploadPartCommand',
      'ListPartsCommand',
      'CompleteMultipartUploadCommand',
      'HeadObjectCommand',
    ]);
    const complete = sent.find(
      (c) => c.name === 'CompleteMultipartUploadCommand'
    );
    expect(complete?.input).toMatchObject({
      UploadId: 'mp-3',
      MultipartUpload: {
        Parts: [
          { PartNumber: 1, ETag: '"p1"' },
          { PartNumber: 2, ETag: '"p2"' },
          { PartNumber: 3, ETag: '"p3"' },
        ],
      },
    });
    expect(result.result).toMatchObject({ size: 10, etag: 'final' });
  });

  it('refuses to complete when parts are missing', async () => {
    handlers.UploadPartCommand = () => ({ ETag: '"p3"' });
    handlers.ListPartsCommand = () => ({
      Parts: [
        { PartNumber: 1, ETag: '"p1"' },
        { PartNumber: 3, ETag: '"p3"' },
      ],
    });

    await expect(
      backend().uploadChunk(
        streamOf('CC'),
        'uploads/ws/s3-missing/original.mp4',
        options({
          chunkIndex: 2,
          totalChunks: 3,
          isFirstChunk: false,
          isLastChunk: true,
          contentLength: 2,
          multipartUploadId: 'mp-4',
        })
      )
    ).rejects.toThrow(/expected 3 uploaded parts but found 2/);
    expect(commandNames()).not.toContain('CompleteMultipartUploadCommand');
  });

  it('rejects when the assembled object size does not match', async () => {
    handlers.UploadPartCommand = () => ({ ETag: '"p2"' });
    handlers.ListPartsCommand = () => ({
      Parts: [
        { PartNumber: 1, ETag: '"p1"' },
        { PartNumber: 2, ETag: '"p2"' },
      ],
    });
    handlers.CompleteMultipartUploadCommand = () => ({});
    handlers.HeadObjectCommand = () => ({ ContentLength: 9 });

    await expect(
      backend().uploadChunk(
        streamOf('BB'),
        'uploads/ws/s3-badsize/original.mp4',
        options({
          chunkIndex: 1,
          totalChunks: 2,
          isFirstChunk: false,
          isLastChunk: true,
          contentLength: 2,
          expectedTotalSize: 10,
          multipartUploadId: 'mp-5',
        })
      )
    ).rejects.toThrow(/upload is corrupt/);
  });
});
