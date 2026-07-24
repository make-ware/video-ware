/**
 * Transport-agnostic scheduler for the chunked-upload protocol shared by the
 * webapp uploader/replacer and the CLI.
 *
 * The protocol (see the /api-next/uploads routes) assembles a file from
 * chunks sent as separate PUT requests. Ordering rules:
 *
 *  1. Chunk 0 is sent ALONE first. Server-side it initializes the target
 *     (creates/truncates the local file, or opens the S3 multipart upload)
 *     and its response may carry a `multipartUploadId` that later chunks
 *     must echo back.
 *  2. Middle chunks (1 .. N-2) are then sent with bounded CONCURRENCY.
 *     Backends place them independently (positioned local writes, S3 parts),
 *     so parallelism hides per-request latency without risking ordering.
 *  3. The last chunk is sent ALONE after every middle chunk succeeded — it
 *     triggers finalization (completeness + size verification), which must
 *     never race an in-flight middle chunk.
 *
 * Any response reporting `complete: true` ends the schedule early (the server
 * answers that way when a retried request finds the upload already finished).
 *
 * This module is isomorphic (browser + Node): the actual HTTP send — retries
 * included — is injected via `sendChunk`.
 */

export interface ChunkSpec {
  /** Chunk index (0-based). */
  index: number;
  /** Byte offset of the chunk within the file. */
  start: number;
  /** Byte length of the chunk (the tail chunk may be short). */
  length: number;
}

/** Split a file size into sequential chunk specs (last chunk may be short). */
export function chunkPlan(fileSize: number, chunkSize: number): ChunkSpec[] {
  const totalChunks = Math.ceil(fileSize / chunkSize);
  const chunks: ChunkSpec[] = [];
  for (let index = 0; index < totalChunks; index++) {
    const start = index * chunkSize;
    chunks.push({
      index,
      start,
      length: Math.min(chunkSize, fileSize - start),
    });
  }
  return chunks;
}

/** The minimum a chunk response must expose for scheduling decisions. */
export interface ChunkSendResult {
  /** True when the server reports the whole upload finished. */
  complete: boolean;
  /** S3 multipart upload id (first-chunk responses; echoed to later chunks). */
  multipartUploadId?: string;
}

export interface ChunkScheduleContext {
  /** Upload session id learned from the first chunk's response, if any. */
  multipartUploadId?: string;
}

export interface ChunkScheduleOptions<R extends ChunkSendResult> {
  chunks: ChunkSpec[];
  /**
   * Max middle chunks in flight at once. 1 reproduces the fully sequential
   * protocol; the first and last chunk are always sent alone regardless.
   */
  concurrency: number;
  /**
   * Send one chunk (including any per-chunk retry policy) and resolve with
   * the server's response. A rejection aborts the schedule: pending chunks
   * are not started, in-flight ones are awaited, and the error rethrows.
   */
  sendChunk: (chunk: ChunkSpec, context: ChunkScheduleContext) => Promise<R>;
}

/**
 * Run the chunk schedule and resolve with the response that reported
 * completion (normally the last chunk's).
 */
export async function runChunkSchedule<R extends ChunkSendResult>(
  options: ChunkScheduleOptions<R>
): Promise<R> {
  const { chunks, sendChunk } = options;
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  if (chunks.length === 0) {
    throw new Error('Cannot upload a file with no chunks');
  }

  // First chunk alone: it initializes the target and names the session.
  const context: ChunkScheduleContext = {};
  const first = await sendChunk(chunks[0], context);
  if (first.complete || chunks.length === 1) {
    return first;
  }
  if (first.multipartUploadId) {
    context.multipartUploadId = first.multipartUploadId;
  }

  // Middle chunks with bounded concurrency. A shared cursor feeds a fixed
  // pool of workers; the first failure stops new sends and propagates after
  // in-flight sends settle.
  const middle = chunks.slice(1, -1);
  let earlyComplete: R | null = null;
  if (middle.length > 0) {
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < middle.length && !earlyComplete) {
        const chunk = middle[cursor++];
        const result = await sendChunk(chunk, context);
        if (result.complete) {
          earlyComplete = result;
        }
      }
    };
    const workers = Array.from(
      { length: Math.min(concurrency, middle.length) },
      () => worker()
    );
    const settled = await Promise.allSettled(workers);
    const failure = settled.find((s) => s.status === 'rejected');
    if (failure && failure.status === 'rejected') {
      throw failure.reason;
    }
  }
  if (earlyComplete) {
    return earlyComplete;
  }

  // Last chunk alone: every other chunk has landed, so the server's
  // finalization (completeness + size checks) sees the finished set.
  return sendChunk(chunks[chunks.length - 1], context);
}
