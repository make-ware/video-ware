import { Processor } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { RenderStepType } from '../../queue/types/step.types';
import {
  TaskRenderPrepareStep,
  TaskRenderExecuteStep,
  TaskRenderFinalizeStep,
} from '@project/shared/jobs';
import { TaskStatus, TaskType } from '@project/shared';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { PrepareRenderStepProcessor } from './prepare-step.processor';
import { ExecuteRenderStepProcessor } from './execute-step.processor';
import { FinalizeRenderStepProcessor } from './finalize-step.processor';
import type {
  ParentJobData,
  StepJobData,
  StepResult,
} from '../../queue/types/job.types';
import { BaseFlowProcessor } from '@/queue/processors';
import { queueWorkerOptions } from '../../queue/worker-options';

/**
 * Parent processor for render tasks
 * Orchestrates child step processors and aggregates results
 */
@Processor(QUEUE_NAMES.RENDER, queueWorkerOptions())
export class RenderParentProcessor extends BaseFlowProcessor {
  protected readonly logger = new Logger(RenderParentProcessor.name);
  protected readonly pocketbaseService: PocketBaseService;
  protected readonly concurrencyConfigKey = 'concurrency.render';

  constructor(
    @InjectQueue(QUEUE_NAMES.RENDER)
    private readonly renderQueue: Queue,
    pocketbaseService: PocketBaseService,
    private readonly prepareStepProcessor: PrepareRenderStepProcessor,
    private readonly executeStepProcessor: ExecuteRenderStepProcessor,
    private readonly finalizeStepProcessor: FinalizeRenderStepProcessor
  ) {
    super();
    this.pocketbaseService = pocketbaseService;
  }

  /**
   * Get the queue instance for accessing child jobs
   */
  protected getQueue(): Queue {
    return this.renderQueue;
  }

  /**
   * Mirror a render failure onto the TimelineRender entity so the UI shows the
   * render as failed (the FINALIZE step never runs when an earlier step fails).
   */
  protected async onParentFailed(
    parentData: ParentJobData,
    error: Error
  ): Promise<void> {
    try {
      const task = await this.pocketbaseService.getTask(parentData.taskId);
      const renderId = task?.sourceId as string | undefined;
      if (!renderId || task?.type !== TaskType.RENDER_TIMELINE) return;

      await this.pocketbaseService.updateTimelineRender(renderId, {
        status: TaskStatus.FAILED,
        errorLog: (error?.message ?? 'Render failed').slice(0, 500),
      });
    } catch (e) {
      this.logger.warn(
        `Failed to mark TimelineRender failed for task ${parentData.taskId}: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }
  }

  /**
   * Clean up render-specific working artifacts once the task is done (on both
   * success and failure, every backend). Removes the deterministic render
   * directory (inputs + output) and the per-clip source downloads in
   * worker-temp that PREPARE resolved. A render's durable copy lives in
   * PocketBase/S3, so the local render tree is always disposable.
   */
  protected async cleanupExtraArtifacts(
    parentData: ParentJobData,
    stepResults: Record<string, StepResult>
  ): Promise<void> {
    await this.storage.cleanupRenderDir(
      parentData.workspaceId,
      parentData.taskId
    );

    const prepareResult = stepResults[RenderStepType.PREPARE];
    const clipMediaMap = (
      prepareResult?.output as
        | { clipMediaMap?: Record<string, unknown> }
        | undefined
    )?.clipMediaMap;

    if (clipMediaMap) {
      for (const mediaId of Object.keys(clipMediaMap)) {
        await this.storage.cleanupTemp(mediaId);
      }
    }
  }

  /**
   * Process parent job - orchestrates child steps and aggregates results
   */
  protected async processParentJob(job: Job<ParentJobData>): Promise<void> {
    const { taskId } = job.data;

    this.logger.log(`Processing parent job for task ${taskId}`);

    const childrenValues = await job.getChildrenValues();

    this.logger.debug(`All children completed for task ${taskId}`, {
      childrenCount: Object.keys(childrenValues).length,
    });

    // Check if any steps failed
    const failedSteps = Object.values(childrenValues).filter(
      (result: unknown) =>
        result &&
        typeof result === 'object' &&
        'status' in result &&
        result.status === 'failed'
    );

    if (failedSteps.length > 0) {
      this.logger.error(
        `Task ${taskId} has ${failedSteps.length} failed steps`
      );
      throw new Error(`Task failed with ${failedSteps.length} failed steps`);
    }

    this.logger.debug(`Task ${taskId} completed successfully`);
  }

  /**
   * Process step job - dispatches to appropriate step processor
   */
  protected async processStepJob(job: Job<StepJobData>): Promise<StepResult> {
    const { stepType, input } = job.data;
    const startedAt = new Date();

    this.logger.debug(`Processing step ${stepType} for job ${job.id}`);

    try {
      let output: unknown;

      // Dispatch to appropriate step processor based on step type
      // Each step processor fetches its own data independently
      switch (stepType) {
        case RenderStepType.PREPARE:
          output = await this.prepareStepProcessor.process(
            input as TaskRenderPrepareStep,
            job
          );
          break;

        case RenderStepType.EXECUTE:
          output = await this.executeStepProcessor.process(
            input as TaskRenderExecuteStep,
            job
          );
          break;

        case RenderStepType.FINALIZE:
          output = await this.finalizeStepProcessor.process(
            input as TaskRenderFinalizeStep,
            job
          );
          break;

        default:
          throw new Error(`Unknown step type: ${stepType}`);
      }

      // Create successful result
      const result: StepResult = {
        stepType,
        status: 'completed',
        output,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
      };

      this.logger.log(`Step ${stepType} completed successfully`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Step ${stepType} failed: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined
      );

      throw error;
    }
  }
}
