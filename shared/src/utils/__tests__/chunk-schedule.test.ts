import { describe, it, expect, vi } from 'vitest';
import {
  chunkPlan,
  runChunkSchedule,
  type ChunkSpec,
  type ChunkScheduleContext,
  type ChunkSendResult,
} from '../chunk-schedule';

/**
 * Tests for the transport-agnostic chunk schedule shared by the webapp
 * uploader/replacer and the CLI.
 *
 * The invariants under test:
 *  - chunk 0 is sent ALONE before anything else (it opens the storage
 *    session whose id later chunks must echo)
 *  - the last chunk is sent ALONE after every middle chunk finished (it
 *    triggers finalization, which must never race an in-flight chunk)
 *  - middle chunks respect the concurrency bound
 *  - `complete: true` ends the schedule early
 *  - a failed chunk aborts the schedule without starting new sends
 */

interface Result extends ChunkSendResult {
  index?: number;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

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
  });

  it('uses a single chunk when the file is smaller than the chunk size', () => {
    expect(chunkPlan(42, 100)).toEqual([{ index: 0, start: 0, length: 42 }]);
  });
});

describe('runChunkSchedule', () => {
  it('sends a single chunk once and returns its response', async () => {
    const sendChunk = vi.fn(
      async (chunk: ChunkSpec): Promise<Result> => ({
        complete: true,
        index: chunk.index,
      })
    );
    const result = await runChunkSchedule({
      chunks: chunkPlan(42, 100),
      concurrency: 3,
      sendChunk,
    });
    expect(result.index).toBe(0);
    expect(sendChunk).toHaveBeenCalledTimes(1);
  });

  it('sends first alone, middles in parallel, last alone', async () => {
    const chunks = chunkPlan(500, 100); // 5 chunks: 0..4
    const gates = new Map<number, ReturnType<typeof deferred<void>>>();
    const started: number[] = [];
    const finished: number[] = [];

    const sendChunk = async (chunk: ChunkSpec): Promise<Result> => {
      started.push(chunk.index);
      const gate = deferred<void>();
      gates.set(chunk.index, gate);
      await gate.promise;
      finished.push(chunk.index);
      return { complete: chunk.index === 4 };
    };

    const run = runChunkSchedule({ chunks, concurrency: 3, sendChunk });

    // Only chunk 0 may start until its send resolves.
    await tick();
    expect(started).toEqual([0]);
    gates.get(0)!.resolve();

    // All three middles (1..3) start together under concurrency 3; the last
    // chunk must NOT start while any middle is in flight.
    await tick();
    expect(started).toEqual([0, 1, 2, 3]);
    gates.get(2)!.resolve();
    await tick();
    expect(started).toEqual([0, 1, 2, 3]); // nothing left to feed the pool
    gates.get(1)!.resolve();
    gates.get(3)!.resolve();

    // Only after every middle settled does the last chunk go out.
    await tick();
    expect(started).toEqual([0, 1, 2, 3, 4]);
    gates.get(4)!.resolve();

    const result = await run;
    expect(result.complete).toBe(true);
    expect(finished[finished.length - 1]).toBe(4);
  });

  it('bounds middle-chunk concurrency', async () => {
    const chunks = chunkPlan(800, 100); // 8 chunks: 6 middles
    let inFlight = 0;
    let peak = 0;
    const sendChunk = async (): Promise<Result> => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight--;
      return { complete: false };
    };

    await runChunkSchedule({ chunks, concurrency: 2, sendChunk });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('threads the multipart upload id from the first response to later sends', async () => {
    const seen: Array<string | undefined> = [];
    const sendChunk = async (
      chunk: ChunkSpec,
      context: ChunkScheduleContext
    ): Promise<Result> => {
      seen.push(context.multipartUploadId);
      return chunk.index === 0
        ? { complete: false, multipartUploadId: 'mp-123' }
        : { complete: chunk.index === 2 };
    };

    await runChunkSchedule({
      chunks: chunkPlan(250, 100),
      concurrency: 2,
      sendChunk,
    });
    expect(seen).toEqual([undefined, 'mp-123', 'mp-123']);
  });

  it('returns early when a response reports the upload already complete', async () => {
    const sendChunk = vi.fn(
      async (chunk: ChunkSpec): Promise<Result> => ({
        complete: true,
        index: chunk.index,
      })
    );
    const result = await runChunkSchedule({
      chunks: chunkPlan(300, 100),
      concurrency: 2,
      sendChunk,
    });
    // First chunk already reported complete — nothing else is sent.
    expect(result.index).toBe(0);
    expect(sendChunk).toHaveBeenCalledTimes(1);
  });

  it('stops scheduling new middles after a failure and rethrows it', async () => {
    const chunks = chunkPlan(600, 100); // middles 1..4
    const sent: number[] = [];
    const sendChunk = async (chunk: ChunkSpec): Promise<Result> => {
      sent.push(chunk.index);
      if (chunk.index === 1) {
        throw new Error('chunk 2 exploded');
      }
      await tick();
      return { complete: false };
    };

    await expect(
      runChunkSchedule({ chunks, concurrency: 1, sendChunk })
    ).rejects.toThrow('chunk 2 exploded');
    // Sequential pool: the failure at chunk 1 prevents chunks 2..5 entirely.
    expect(sent).toEqual([0, 1]);
  });

  it('rejects an empty chunk list', async () => {
    await expect(
      runChunkSchedule({
        chunks: [],
        concurrency: 3,
        sendChunk: async () => ({ complete: true }),
      })
    ).rejects.toThrow(/no chunks/i);
  });
});
