import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { PocketBaseService } from '../shared/services/pocketbase.service';
import { QueueService } from '../queue/queue.service';
import { TaskStatus, type Task } from '@project/shared';

@Injectable()
export class TaskEnqueuerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TaskEnqueuerService.name);
  private isPolling = false;
  private _lastPollTs?: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly pocketbaseService: PocketBaseService,
    private readonly queueService: QueueService
  ) {}

  onApplicationBootstrap() {
    if (!this.isEnabled()) {
      this.logger.log('Task enqueuer is disabled (ENABLE_TASK_ENQUEUER=false)');
      return;
    }

    // Kick one poll immediately so we don't wait for the first interval tick.
    void this.pollOnce();
  }

  @Interval('task-enqueuer', 5000)
  async pollIntervalTick() {
    if (!this.isEnabled()) return;
    await this.pollOnce();
  }

  private isEnabled(): boolean {
    return this.configService.get<boolean>('tasks.enqueuerEnabled', true);
  }

  private getPollIntervalMs(): number {
    return this.configService.get<number>('tasks.enqueuerPollIntervalMs', 5000);
  }

  private getBatchSize(): number {
    return this.configService.get<number>('tasks.enqueuerBatchSize', 25);
  }

  private async pollOnce(): Promise<void> {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      // PocketBaseService connects/initializes mutators on startup. If it's not ready yet, skip.
      if (!this.pocketbaseService.taskMutator) {
        this.logger.debug(
          'PocketBase mutators not ready yet; skipping enqueue poll'
        );
        return;
      }

      const pollInterval = this.getPollIntervalMs();
      const batchSize = this.getBatchSize();

      // Keep the Nest schedule interval fixed; allow runtime-configured pacing here.
      // This avoids changing decorators based on env vars.
      if (pollInterval > 5000) {
        // If user configured a slower poll, respect it by skipping most ticks.
        const now = Date.now();
        const last = this._lastPollTs;
        if (last && now - last < pollInterval) return;
        this._lastPollTs = now;
      }

      const queued = await this.pocketbaseService.taskMutator.getQueuedTasks(
        undefined,
        1,
        batchSize
      );

      if (queued.items.length === 0) return;

      this.logger.log(`Found ${queued.items.length} queued task(s) to enqueue`);

      for (const task of queued.items) {
        await this.enqueueTaskIfNeeded(task);
      }
    } catch (error) {
      this.logger.error(
        `Task enqueue poll failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Enqueue a task to the appropriate queue.
   * Uses QueueService.enqueueTask() which routes to the correct queue (flow or regular job)
   * based on task type via exhaustive switch case.
   * BullMQ handles deduplication via jobId - if a job with the same ID already exists,
   * BullMQ will throw an error, which we treat as benign (job is already enqueued).
   */
  private async enqueueTaskIfNeeded(task: Task): Promise<void> {
    if (task.status !== TaskStatus.QUEUED) return;

    try {
      // Enqueue task using QueueService - it will route to the correct queue based on task type
      await this.queueService.enqueueTask(task);

      // Mark task as running in PocketBase so it's not re-polled
      await this.markTaskClaimed(task.id);
      this.logger.debug(`Successfully enqueued task ${task.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // BullMQ throws if a job with the same jobId already exists - this is expected
      if (
        (message.toLowerCase().includes('job') &&
          message.toLowerCase().includes('already')) ||
        message.toLowerCase().includes('exists')
      ) {
        this.logger.debug(
          `Task ${task.id} already enqueued; marking as claimed`
        );
        await this.markTaskClaimed(task.id);
        return;
      }

      // Unexpected error - log and continue to next task
      this.logger.error(`Failed to enqueue task ${task.id}: ${message}`);
    }
  }

  /**
   * Once we know a Bull job exists for the taskId, flip the PocketBase task out of `queued`
   * so the scheduler won't keep re-polling it.
   */
  private async markTaskClaimed(taskId: string): Promise<void> {
    try {
      await this.pocketbaseService.updateTask(taskId, {
        status: TaskStatus.RUNNING,
      });
    } catch {
      // Best-effort: if PB update fails, the unique Bull jobId still prevents duplicates.
    }
  }
}
