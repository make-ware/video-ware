import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from './queue.constants';
import { FlowService } from './flow.service';
import { JobService } from './job.service';
import { TaskType } from '@project/shared';
import type { Task } from '@project/shared';

/**
 * QueueService provides a thin wrapper around BullMQ queues.
 * BullMQ handles job deduplication via jobId, so we don't need
 * custom dedup logic. Bull Board provides job tracking and management UI.
 */
@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.TRANSCODE) private transcodeQueue: Queue,
    @InjectQueue(QUEUE_NAMES.INTELLIGENCE) private intelligenceQueue: Queue,
    @InjectQueue(QUEUE_NAMES.RENDER) private renderQueue: Queue,
    private readonly flowService: FlowService,
    private readonly jobService: JobService
  ) {}

  /**
   * Single entry point for enqueueing tasks.
   * Exhaustive switch ensures all TaskType enum values are handled.
   *
   * @param task - Task to enqueue
   * @returns Job ID or parent job ID
   */
  async enqueueTask(task: Task): Promise<string> {
    this.logger.log(`Enqueueing task ${task.id} (type: ${task.type})`);

    switch (task.type as TaskType) {
      // Flow-based jobs (multi-step with parent-child relationships)
      case TaskType.PROCESS_UPLOAD:
        return this.addTranscodeJob(task);

      case TaskType.DETECT_LABELS:
        return this.addIntelligenceJob(task);

      case TaskType.RENDER_TIMELINE:
        return this.addRenderJob(task);

      case TaskType.FULL_INGEST:
        return this.addFullIngestJob(task);

      default: {
        throw new Error(`Unknown task type: ${task.type}`);
      }
    }
  }

  /**
   * Add a transcode job to the queue.
   * Creates a flow with parent-child jobs for step-based processing.
   */
  async addTranscodeJob(task: Task) {
    return this.jobService.submitTranscodeJob(task);
  }

  /**
   * Add an intelligence job to the queue.
   * Creates a flow with parent-child jobs for step-based processing.
   */
  async addIntelligenceJob(task: Task) {
    return this.jobService.submitLabelsJob(task);
  }

  /**
   * Add a render job to the queue.
   * Creates a flow with parent-child jobs for step-based processing.
   */
  async addRenderJob(task: Task) {
    return this.jobService.submitRenderJob(task);
  }

  /**
   * Add a full ingest job to the queue.
   */
  async addFullIngestJob(task: Task) {
    return this.jobService.submitFullIngestJob(task);
  }

  /**
   * Get metrics for all queues.
   * Use Bull Board for detailed job tracking and management.
   */
  async getQueueMetrics() {
    const [transcodeMetrics, intelligenceMetrics, renderMetrics] =
      await Promise.all([
        this.getQueueStats(this.transcodeQueue),
        this.getQueueStats(this.intelligenceQueue),
        this.getQueueStats(this.renderQueue),
      ]);

    return {
      transcode: transcodeMetrics,
      intelligence: intelligenceMetrics,
      render: renderMetrics,
    };
  }

  private async getQueueStats(queue: Queue) {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }
}
