/**
 * Browser transport for the chunked upload protocol shared by the upload and
 * replace routes.
 *
 * Scheduling (first chunk alone → middle chunks in parallel → last chunk
 * alone) comes from the shared `runChunkSchedule`; this module contributes
 * the XHR send with per-chunk retries, abort wiring, and progress accounting
 * across concurrently in-flight chunks.
 */

import {
  runChunkSchedule,
  chunkPlan,
  type ChunkSpec,
  type ChunkScheduleContext,
} from '@project/shared';
import type { TypedPocketBase, Upload } from '@project/shared';

/** JSON body the upload/replace routes answer chunk PUTs with. */
export interface ChunkRouteResponse {
  complete: boolean;
  multipartUploadId?: string;
  upload?: Upload;
  externalPath?: string;
}

/** Progress snapshot emitted as bytes move, across all in-flight chunks. */
export interface ChunkTransferProgress {
  /** The chunk this event originated from. */
  chunk: ChunkSpec;
  /** Bytes of that chunk transferred so far. */
  chunkLoaded: number;
  /** Total bytes transferred across all chunks (completed + in-flight). */
  bytesUploaded: number;
  totalBytes: number;
  totalChunks: number;
}

export interface DriveChunkedTransferOptions {
  pb: TypedPocketBase;
  /** Route to PUT chunks to (upload or replace). */
  url: string;
  file: File;
  uploadId: string;
  workspaceId: string;
  userId: string;
  directoryId?: string;
  chunkSize: number;
  /** Middle chunks in flight at once (first/last always go alone). */
  concurrency: number;
  maxRetries: number;
  /** Per-chunk request timeout (ms). */
  timeout: number;
  abortSignal: AbortSignal;
  onProgress?: (progress: ChunkTransferProgress) => void;
}

/** A failed chunk request; `retryable` says whether another attempt helps. */
class ChunkRequestError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'ChunkRequestError';
    this.retryable = retryable;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One XHR PUT of one chunk; resolves with the route's JSON response. */
function putChunk(
  options: DriveChunkedTransferOptions,
  chunk: ChunkSpec,
  context: ChunkScheduleContext,
  totalChunks: number,
  onChunkProgress: (loaded: number) => void
): Promise<ChunkRouteResponse> {
  return new Promise((resolve, reject) => {
    const token = options.pb.authStore.token;
    if (!token) {
      reject(
        new ChunkRequestError('User must be authenticated to upload', false)
      );
      return;
    }

    const xhr = new XMLHttpRequest();

    const abortHandler = () => {
      xhr.abort();
      reject(new ChunkRequestError('Upload cancelled', false));
    };
    options.abortSignal.addEventListener('abort', abortHandler);
    const cleanup = () =>
      options.abortSignal.removeEventListener('abort', abortHandler);

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onChunkProgress(event.loaded);
      }
    });

    xhr.addEventListener('load', () => {
      cleanup();
      let body: ChunkRouteResponse & { error?: string };
      try {
        body = JSON.parse(xhr.responseText) as ChunkRouteResponse & {
          error?: string;
        };
      } catch {
        body = { complete: false };
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body);
      } else {
        const message =
          body.error ?? `Chunk ${chunk.index + 1} failed (HTTP ${xhr.status})`;
        // Auth/validation errors won't self-heal; 429/5xx might.
        reject(
          new ChunkRequestError(
            message,
            xhr.status === 429 || xhr.status >= 500
          )
        );
      }
    });

    xhr.addEventListener('error', () => {
      cleanup();
      reject(
        new ChunkRequestError(
          `Network error uploading chunk ${chunk.index + 1}`,
          true
        )
      );
    });

    xhr.addEventListener('timeout', () => {
      cleanup();
      reject(
        new ChunkRequestError(`Chunk ${chunk.index + 1} upload timed out`, true)
      );
    });

    const blob = options.file.slice(chunk.start, chunk.start + chunk.length);

    xhr.open('PUT', options.url);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('x-upload-id', options.uploadId);
    xhr.setRequestHeader('x-workspace-id', options.workspaceId);
    xhr.setRequestHeader('x-user-id', options.userId);
    xhr.setRequestHeader('x-file-name', options.file.name);
    xhr.setRequestHeader('x-chunk-index', String(chunk.index));
    xhr.setRequestHeader('x-total-chunks', String(totalChunks));
    xhr.setRequestHeader('x-chunk-size', String(blob.size));
    xhr.setRequestHeader('x-chunk-offset', String(chunk.start));
    xhr.setRequestHeader('x-total-size', String(options.file.size));
    if (context.multipartUploadId) {
      xhr.setRequestHeader('x-multipart-upload-id', context.multipartUploadId);
    }
    if (options.directoryId) {
      xhr.setRequestHeader('x-directory-id', options.directoryId);
    }
    xhr.timeout = options.timeout;

    xhr.send(blob);
  });
}

/**
 * Upload a file to a chunk route: plan chunks, schedule them (parallel
 * middles), retry each chunk with exponential backoff, and account progress
 * across in-flight chunks. Resolves with the response that confirmed
 * completion.
 */
export async function driveChunkedTransfer(
  options: DriveChunkedTransferOptions
): Promise<ChunkRouteResponse> {
  const chunks = chunkPlan(options.file.size, options.chunkSize);

  // Bytes transferred per chunk, so overall progress stays accurate no
  // matter how many chunks are in flight or in what order they finish.
  const loadedByChunk = new Map<number, number>();
  const reportProgress = (chunk: ChunkSpec, loaded: number) => {
    loadedByChunk.set(chunk.index, loaded);
    if (!options.onProgress) return;
    let bytesUploaded = 0;
    for (const value of loadedByChunk.values()) bytesUploaded += value;
    options.onProgress({
      chunk,
      chunkLoaded: loaded,
      bytesUploaded,
      totalBytes: options.file.size,
      totalChunks: chunks.length,
    });
  };

  const sendWithRetries = async (
    chunk: ChunkSpec,
    context: ChunkScheduleContext
  ): Promise<ChunkRouteResponse> => {
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await putChunk(
          options,
          chunk,
          context,
          chunks.length,
          (loaded) => reportProgress(chunk, loaded)
        );
        reportProgress(chunk, chunk.length);
        return result;
      } catch (error) {
        // A user cancel is terminal, whatever shape it surfaced as.
        if (options.abortSignal.aborted) {
          throw error;
        }
        const retryable =
          !(error instanceof ChunkRequestError) || error.retryable;
        if (!retryable || attempt >= options.maxRetries) {
          throw new Error(
            `Failed to upload chunk ${chunk.index + 1}/${chunks.length}` +
              (attempt > 0 ? ` after ${attempt + 1} attempts` : '') +
              `: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
        // The retry restarts the chunk from zero — reset its progress so the
        // overall count doesn't double-count the failed attempt's bytes.
        reportProgress(chunk, 0);
        await sleep(Math.pow(2, attempt + 1) * 1000);
      }
    }
  };

  return runChunkSchedule<ChunkRouteResponse>({
    chunks,
    concurrency: options.concurrency,
    sendChunk: sendWithRetries,
  });
}
