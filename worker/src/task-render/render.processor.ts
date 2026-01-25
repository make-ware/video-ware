import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { FlowService } from '../queue/flow.service';
import { RenderFlowBuilder } from '../queue/flows';
import { PocketBaseService } from '../shared/services/pocketbase.service';
import { Task, TaskStatus } from '@project/shared';

@Processor(QUEUE_NAMES.RENDER)
export class RenderProcessor {
  private readonly logger = new Logger(RenderProcessor.name);

  constructor(
    private readonly flowService: FlowService,
    private readonly pocketbaseService: PocketBaseService
  ) {}

  @Process('process')
  async handleRender(job: Job<Task>) {
    const task = job.data;
    this.logger.log(`Processing render task ${task.id} (job ${job.id})`);

    try {
      // Update task status to running
      await this.updateTaskStatus(task.id, TaskStatus.RUNNING, 0);

      // Create the render flow (new flow-based architecture)
      const flowDefinition = RenderFlowBuilder.buildFlow(task);
      const parentJobId = await this.flowService.addFlow(flowDefinition);

      this.logger.log(
        `Render flow created for task ${task.id}, parent job: ${parentJobId}`
      );

      // Return the parent job ID
      return { parentJobId };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `Render task ${task.id} failed: ${errorMessage}`,
        errorStack
      );

      // Update task status to failed with error
      await this.updateTaskStatus(
        task.id,
        TaskStatus.FAILED,
        undefined,
        undefined,
        errorMessage
      );

      // Re-throw error so Bull can handle retry logic
      throw error;
    }
  }

  /**
   * Update task status in PocketBase
   */
  private async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    progress?: number,
    result?: unknown,
    error?: string
  ): Promise<void> {
    try {
      const updates: Record<string, unknown> = { status };

      if (progress !== undefined) {
        updates.progress = Math.round(progress);
      }

      if (result !== undefined) {
        updates.result = result;
      }

      if (error !== undefined) {
        updates.errorLog = error;
      }

      // Add timestamp for status changes
      if (status === 'running') {
        updates.startedAt = new Date().toISOString();
      } else if (status === 'success' || status === 'failed') {
        updates.completedAt = new Date().toISOString();
      }

      await this.pocketbaseService.updateTask(taskId, updates);

      this.logger.debug(
        `Updated task ${taskId} status to ${status}${progress !== undefined ? ` (${progress}%)` : ''}`
      );
    } catch (updateError) {
      this.logger.error(
        `Failed to update task ${taskId} status: ${updateError instanceof Error ? updateError.message : String(updateError)}`
      );
      // Don't throw here as it would interfere with the main processing
    }
  }

  /**
   * Update task progress in PocketBase
   */
  private async updateTaskProgress(
    taskId: string,
    progress: number
  ): Promise<void> {
    try {
      await this.pocketbaseService.updateTask(taskId, {
        progress: Math.round(progress),
      });
    } catch (error) {
      // Log but don't throw - progress updates are not critical
      this.logger.debug(
        `Failed to update task ${taskId} progress: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Handle job completion (success or failure)
   */
  @Process('completed')
  async handleCompleted(job: Job<Task>) {
    const task = job.data;
    this.logger.log(`Render job ${job.id} for task ${task.id} completed`);
  }

  /**
   * Handle job failure
   */
  @Process('failed')
  async handleFailed(job: Job<Task>, error: Error) {
    const task = job.data;
    this.logger.error(
      `Render job ${job.id} for task ${task.id} failed: ${error.message}`
    );

    // The task status should already be updated in the main handler,
    // but we can add additional failure handling here if needed
  }

  /**
   * Handle job stalled (taking too long)
   */
  @Process('stalled')
  async handleStalled(job: Job<Task>) {
    const task = job.data;
    this.logger.warn(`Render job ${job.id} for task ${task.id} stalled`);

    // Optionally update task status to indicate it's stalled
    await this.updateTaskStatus(
      task.id,
      TaskStatus.RUNNING,
      undefined,
      undefined,
      'Job stalled - may be retried'
    );
  }

  /**
   * Handle job progress updates
   */
  @Process('progress')
  async handleProgress(job: Job<Task>, progress: number) {
    const task = job.data;
    this.logger.debug(
      `Render job ${job.id} for task ${task.id} progress: ${progress}%`
    );
  }

  /**
   * Handle job active (started processing)
   */
  @Process('active')
  async handleActive(job: Job<Task>) {
    const task = job.data;
    this.logger.log(
      `Render job ${job.id} for task ${task.id} started processing`
    );
  }

  /**
   * Handle job waiting (queued)
   */
  @Process('waiting')
  async handleWaiting(job: Job<Task>) {
    const task = job.data;
    this.logger.debug(
      `Render job ${job.id} for task ${task.id} is waiting in queue`
    );
  }
}
