import { OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { TaskStatus } from '@project/shared';
import { BaseProcessor } from './base.processor';
import { TaskResult } from './base-flow.processor';

/**
 * Job data structure for simple (non-flow) jobs
 *
 * IMPORTANT: This data is idempotent configuration only
 * - Contains only input configuration, not execution state
 * - Can be safely retried without side effects
 * - Execution artifacts are stored in database/filesystem, not here
 */
export interface SimpleJobData {
  taskId: string;
  workspaceId: string;
  input: unknown; // Job-specific configuration input
  [key: string]: unknown; // Additional configuration data
}

/**
 * Abstract base class for simple BullMQ job processors
 * Use this for standalone jobs that don't have parent-child relationships
 *
 * Provides:
 * - Automatic task status updates (RUNNING → SUCCESS/FAILED)
 * - Error handling and logging
 * - Job lifecycle event handlers
 *
 * Subclasses must implement:
 * - process(job): Main job processing logic
 */
export abstract class BaseSimpleProcessor<
  TJobData extends SimpleJobData = SimpleJobData,
  TResult = unknown,
> extends BaseProcessor {
  /**
   * Main process method - must be implemented by subclass
   * Should contain the core job logic
   *
   * @param job - The BullMQ job to process
   * @returns Result data to be stored with the job
   */
  abstract process(job: Job<TJobData>): Promise<TResult>;

  /**
   * Handle job becoming active
   * Updates task status to RUNNING
   */
  @OnWorkerEvent('active')
  async onActive(job: Job<TJobData>) {
    this.logger.log(`Job ${job.id} started for task ${job.data.taskId}`);
    await this.updateTask(job.data.taskId, {
      status: TaskStatus.RUNNING,
    });
  }

  /**
   * Handle job completion
   * Updates task status to SUCCESS
   */
  @OnWorkerEvent('completed')
  async onCompleted(job: Job<TJobData>, result: TResult) {
    this.logger.log(`Job ${job.id} completed for task ${job.data.taskId}`);
    await this.updateTask(job.data.taskId, {
      status: TaskStatus.SUCCESS,
      result: result as TaskResult,
    });
  }

  /**
   * Handle job failure
   * Updates task status to FAILED with error information
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<TJobData> | undefined, error: Error) {
    if (!job) {
      this.logger.error(`Job failed: ${error.message}`);
      return;
    }

    const attemptsMade = job.attemptsMade;
    const maxAttempts = job.opts.attempts || 3;

    if (attemptsMade >= maxAttempts) {
      // Job exhausted all retries
      this.logger.error(
        `Job ${job.id} exhausted all ${maxAttempts} retry attempts for task ${job.data.taskId}: ${error.message}`
      );

      await this.updateTask(job.data.taskId, {
        status: TaskStatus.FAILED,
        errorLog: this.createErrorLogEntry('job', error, {
          jobId: job.id,
          attemptsMade,
          maxAttempts,
        }),
      });
    } else {
      // Job will retry
      this.logger.warn(
        `Job ${job.id} failed (attempt ${attemptsMade}/${maxAttempts}) for task ${job.data.taskId}, will retry: ${error.message}`
      );

      await this.updateTask(job.data.taskId, {
        status: TaskStatus.RUNNING,
      });
    }
  }
}
