import { WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { TaskStatus } from '@project/shared';
import { TaskResult } from './base-flow.processor';

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
export abstract class BaseProcessor extends WorkerHost {
  protected abstract readonly logger: Logger;
  protected abstract readonly pocketbaseService: PocketBaseService;

  /**
   * Update task status in PocketBase
   * Handles errors gracefully to avoid blocking job processing
   */
  protected async updateTaskStatus(
    taskId: string,
    status: TaskStatus
  ): Promise<void> {
    try {
      await this.pocketbaseService.taskMutator.update(taskId, { status });
      this.logger.log(`Updated task ${taskId} status to ${status}`);
    } catch (error) {
      this.logger.warn(
        `Failed to update task ${taskId} status: ${this.formatError(error)}`
      );
    }
  }

  /**
   * Update task with multiple fields
   * Handles errors gracefully to avoid blocking job processing
   */
  protected async updateTask(
    taskId: string,
    updates: {
      status?: TaskStatus;
      progress?: number;
      result?: TaskResult;
      errorLog?: string;
    }
  ): Promise<void> {
    try {
      const updatePayload: {
        status?: TaskStatus;
        progress?: number;
        result?: TaskResult;
        errorLog?: string;
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

      await this.pocketbaseService.updateTask(taskId, updatePayload);

      this.logger.debug(
        `Updated task ${taskId}: status=${updates.status || 'unchanged'}, progress=${updates.progress !== undefined ? `${updates.progress}%` : 'unchanged'}`
      );
    } catch (error) {
      this.logger.warn(
        `Failed to update task ${taskId}: ${this.formatError(error)}`
      );
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
