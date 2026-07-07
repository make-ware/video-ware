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
   * status is sticky once set (e.g. by the hung-task watchdog cron or a
   * user-initiated cancel), so a late event from a stale/zombie job attempt
   * must not resurrect it. Still never throws, to avoid destabilizing the
   * BullMQ event handler that called it.
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
          this.logger.warn(
            `Skipping update for task ${taskId}: already in terminal status "${current.status}" — ignoring stale event from a reassigned or watchdog-failed job`
          );
          return;
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
