import { describe, it, expect } from 'vitest';
import { AsyncMutex, MinIntervalGate } from '../concurrency';

/** A promise whose resolution the test controls. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Let queued microtasks run. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('AsyncMutex', () => {
  it('serializes overlapping callbacks in FIFO order', async () => {
    const mutex = new AsyncMutex();
    const events: string[] = [];
    const first = deferred();

    const a = mutex.run(async () => {
      events.push('a:start');
      await first.promise;
      events.push('a:end');
    });
    const b = mutex.run(async () => {
      events.push('b:start');
    });

    await tick();
    // b must not start while a holds the lock
    expect(events).toEqual(['a:start']);
    expect(mutex.locked).toBe(true);

    first.resolve();
    await Promise.all([a, b]);
    expect(events).toEqual(['a:start', 'a:end', 'b:start']);
    expect(mutex.locked).toBe(false);
  });

  it('releases the lock when a callback throws', async () => {
    const mutex = new AsyncMutex();
    const failure = new Error('boom');

    const a = mutex.run(async () => {
      throw failure;
    });
    const b = mutex.run(async () => 'ran');

    await expect(a).rejects.toBe(failure);
    await expect(b).resolves.toBe('ran');
    expect(mutex.locked).toBe(false);
  });

  it('propagates return values', async () => {
    const mutex = new AsyncMutex();
    await expect(mutex.run(() => 42)).resolves.toBe(42);
  });
});

describe('MinIntervalGate', () => {
  it('spaces concurrent callers one interval apart', async () => {
    const now = 1_000;
    const sleeps: number[] = [];
    const gate = new MinIntervalGate(5_000, {
      now: () => now,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });

    await gate.wait(); // first caller passes immediately
    await gate.wait(); // reserved 5s later
    await gate.wait(); // reserved 10s later
    expect(sleeps).toEqual([5_000, 10_000]);
  });

  it('does not accumulate debt across idle periods', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const gate = new MinIntervalGate(5_000, {
      now: () => now,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });

    await gate.wait();
    now += 60_000; // long idle; the next slot is in the past
    await gate.wait();
    expect(sleeps).toEqual([]);
  });

  it('is a no-op with a zero interval', async () => {
    const gate = new MinIntervalGate(0, {
      sleep: () => {
        throw new Error('should not sleep');
      },
    });
    await gate.wait();
    await gate.wait();
  });
});
