/**
 * Small async coordination primitives for bounding what a single worker
 * process does concurrently (bandwidth, external API request rate).
 *
 * These are process-local. Cross-process safety still relies on the guarded
 * operations being idempotent (e.g. deterministic GCS paths make a duplicate
 * upload redundant, not harmful).
 */

/**
 * FIFO async mutex. `run` executes the callback once every previously queued
 * callback has settled; a throwing callback releases the lock normally and
 * its rejection propagates only to its own caller.
 */
export class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();
  private holders = 0;

  /** Whether any callback currently holds or is queued for the lock. */
  get locked(): boolean {
    return this.holders > 0;
  }

  run<T>(fn: () => Promise<T> | T): Promise<T> {
    const prev = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.holders += 1;
    return (async () => {
      await prev;
      try {
        return await fn();
      } finally {
        this.holders -= 1;
        release();
      }
    })();
  }
}

/**
 * Spaces callers a minimum interval apart on a shared virtual clock. Each
 * `wait()` synchronously reserves the earliest free slot, so concurrent
 * callers resolve one interval apart in call order regardless of how many
 * are waiting. An interval of 0 disables the gate.
 *
 * `now`/`sleep` are injectable so owners can route through their own clock
 * (and tests can stub delays away).
 */
export class MinIntervalGate {
  private nextSlotAt = 0;

  constructor(
    private readonly minIntervalMs: number,
    private readonly deps: {
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
    } = {}
  ) {}

  wait(): Promise<void> {
    if (this.minIntervalMs <= 0) return Promise.resolve();
    const now = (this.deps.now ?? Date.now)();
    const slot = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = slot + this.minIntervalMs;
    const delayMs = slot - now;
    if (delayMs <= 0) return Promise.resolve();
    const sleep =
      this.deps.sleep ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    return sleep(delayMs);
  }
}
