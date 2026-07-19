import { WorkerHost } from '@nestjs/bullmq';
import { Logger, Inject } from '@nestjs/common';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { WorkerControlService } from '../../shared/services/worker-control.service';
import { TaskStatus } from '@project/shared';
import { TaskResult } from '../types/job.types';

/**
 * Abstract base class for all BullMQ processors
 * Provides common functionality for task status updates and error handling
 *
 * Key principles:
 * - Jobs are idempotent: job data contains only configuration, not execution state
 * - Execution state is stored in database/filesystem, not in job data
 * - Job data can be safely retried without side effects
 *
 * All processors should extend this class to ensure consistent:
 * - Logging patterns
 * - PocketBase integration
 * - Task status management
 * - Error handling
 */
// Task.status is typed as `TaskStatus | TaskStatus[]` by the shared Zod
// schema helper (SelectField's return type covers both single- and
// multi-select), even though this field is single-select — so this checks by
// equality rather than via Set.has(), which would reject the union type.
function isTerminalTaskStatus(status: TaskStatus | TaskStatus[]): boolean {
  return (
    status === TaskStatus.SUCCESS ||
    status === TaskStatus.FAILED ||
    status === TaskStatus.CANCELED
  );
}

// The hung-task watchdog cron (pb/pb_hooks/cron-tasks-watchdog.pb.js) writes
// errorLog with this prefix when it fails a task it believes is dead. That
// verdict is a heuristic — "no worker event will ever come for this task" —
// so a later status-bearing event from the live job disproves it and is
// allowed to take the task back (see updateTask).
const WATCHDOG_ERROR_PREFIX = 'watchdog:';

const UPDATE_RETRY_ATTEMPTS = 3;
const UPDATE_RETRY_BASE_DELAY_MS = 250;

export abstract class BaseProcessor extends WorkerHost {
  protected abstract readonly logger: Logger;
  protected abstract readonly pocketbaseService: PocketBaseService;

  @Inject(WorkerControlService)
  protected readonly workerControlService!: WorkerControlService;

  /**
   * Update task status in PocketBase
   * Handles errors gracefully to avoid blocking job processing
   */
  protected async updateTaskStatus(
    taskId: string,
    status: TaskStatus
  ): Promise<void> {
    await this.updateTask(taskId, { status });
  }

  /**
   * Update task with multiple fields. Retries transient PocketBase write
   * failures instead of dropping them silently, and refuses to write over a
   * task already in a terminal status (success/failed/canceled) — that
   * status is sticky once set (e.g. a user-initiated cancel), so a late
   * event from a stale/zombie job attempt must not resurrect it.
   *
   * One carve-out: a task the watchdog cron failed (errorLog prefixed
   * "watchdog:") may be taken back by a status-bearing update. The watchdog
   * only fires on the premise that the worker died and no event will ever
   * arrive; a live event carrying a status proves that premise false (e.g.
   * the task was just stuck behind a long queue backlog), so the live status
   * wins and the stale watchdog note is cleared.
   *
   * Still never throws, to avoid destabilizing the BullMQ event handler that
   * called it.
   */
  protected async updateTask(
    taskId: string,
    updates: {
      status?: TaskStatus;
      progress?: number;
      result?: TaskResult;
      errorLog?: string;
      bullJobId?: string;
      queueName?: string;
    }
  ): Promise<void> {
    const updatePayload: {
      status?: TaskStatus;
      progress?: number;
      result?: TaskResult;
      errorLog?: string;
      bullJobId?: string;
      queueName?: string;
    } = {};

    if (updates.status !== undefined) {
      updatePayload.status = updates.status;
    }

    if (updates.progress !== undefined) {
      // Ensure progress is between 0 and 100
      updatePayload.progress = Math.max(
        0,
        Math.min(100, Math.round(updates.progress))
      );
    }

    if (updates.result !== undefined) {
      updatePayload.result = updates.result;
    }

    if (updates.errorLog !== undefined) {
      updatePayload.errorLog = updates.errorLog;
    }

    if (updates.bullJobId !== undefined) {
      updatePayload.bullJobId = updates.bullJobId;
    }

    if (updates.queueName !== undefined) {
      updatePayload.queueName = updates.queueName;
    }

    for (let attempt = 1; attempt <= UPDATE_RETRY_ATTEMPTS; attempt++) {
      try {
        const current = await this.pocketbaseService.getTask(taskId);
        if (current && isTerminalTaskStatus(current.status)) {
          const watchdogFailed =
            current.status === TaskStatus.FAILED &&
            typeof current.errorLog === 'string' &&
            current.errorLog.startsWith(WATCHDOG_ERROR_PREFIX);

          if (!watchdogFailed || updatePayload.status === undefined) {
            this.logger.warn(
              `Skipping update for task ${taskId}: already in terminal status "${current.status}" — ignoring stale event from a reassigned or terminally-failed job`
            );
            return;
          }

          // Status-bearing event on a watchdog-failed task: the job is
          // demonstrably alive, so the reap was a false positive. Clear the
          // stale watchdog note unless this update carries its own error.
          if (updatePayload.errorLog === undefined) {
            updatePayload.errorLog = '';
          }
          this.logger.warn(
            `Task ${taskId} was failed by the watchdog but its job is still alive — applying live status "${updatePayload.status}" and clearing the watchdog error`
          );
        }

        await this.pocketbaseService.updateTask(taskId, updatePayload);

        this.logger.debug(
          `Updated task ${taskId}: status=${updates.status || 'unchanged'}, progress=${updates.progress !== undefined ? `${updates.progress}%` : 'unchanged'}`
        );
        return;
      } catch (error) {
        if (attempt === UPDATE_RETRY_ATTEMPTS) {
          this.logger.error(
            `Failed to update task ${taskId} after ${attempt} attempts: ${this.formatError(error)}`,
            error instanceof Error ? error.stack : undefined
          );
          return;
        }

        this.logger.warn(
          `Retrying update for task ${taskId} (attempt ${attempt}/${UPDATE_RETRY_ATTEMPTS}): ${this.formatError(error)}`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, UPDATE_RETRY_BASE_DELAY_MS * attempt)
        );
      }
    }
  }

  /**
   * Format error for logging
   */
  protected formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  /**
   * Create error log entry
   */
  protected createErrorLogEntry(
    step: string,
    error: unknown,
    context?: Record<string, unknown>
  ): string {
    const entry = {
      timestamp: new Date().toISOString(),
      step,
      error: this.formatError(error),
      stack: error instanceof Error ? error.stack : undefined,
      context,
    };

    return JSON.stringify([entry], null, 2);
  }
}
