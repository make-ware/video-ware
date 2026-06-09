import type { WorkerOptions } from 'bullmq';

/**
 * Construction-time BullMQ worker options shared by all queue processors.
 *
 * `lockDuration` can only be set when the Worker is constructed (not at
 * runtime), so it lives here rather than in ConfigService. Long ffmpeg jobs
 * must not be marked "stalled" mid-run; BullMQ auto-renews the lock on a timer
 * while the process is alive, so a generous lock mainly protects against
 * transient event-loop pressure under concurrency.
 *
 * Concurrency is applied separately at runtime (see BaseFlowProcessor) because
 * it is read from ConfigService and supports the `.env` file in local dev.
 */
export function queueWorkerOptions(): Pick<WorkerOptions, 'lockDuration'> {
  const raw = process.env.WORKER_LOCK_DURATION_MS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  const lockDuration = Number.isFinite(parsed) && parsed > 0 ? parsed : 60000;
  return { lockDuration };
}
