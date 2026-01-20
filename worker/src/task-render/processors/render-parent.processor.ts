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

/**
 * Parent processor for render tasks
 * Orchestrates child step processors and aggregates results
 */
@Processor(QUEUE_NAMES.RENDER)
export class RenderParentProcessor extends BaseFlowProcessor {
  protected readonly logger = new Logger(RenderParentProcessor.name);
  protected readonly pocketbaseService: PocketBaseService;

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
   * Process parent job - orchestrates child steps and aggregates results
   */
  protected async processParentJob(job: Job<ParentJobData>): Promise<void> {
    const { taskId } = job.data;

    this.logger.log(`Processing parent job for task ${taskId}`);

    const childrenValues = await job.getChildrenValues();

    this.logger.log(`All children completed for task ${taskId}`, {
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

    this.logger.log(`Task ${taskId} completed successfully`);
  }

  /**
   * Process step job - dispatches to appropriate step processor
   */
  protected async processStepJob(job: Job<StepJobData>): Promise<StepResult> {
    const { stepType, input } = job.data;
    const startedAt = new Date();

    this.logger.log(`Processing step ${stepType} for job ${job.id}`);

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
