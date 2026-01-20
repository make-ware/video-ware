import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import type { StepJobData, StepResult } from '../types/job.types';
import type { StepType } from '../types/step.types';

/**
 * Abstract base class for all step processors
 * Provides common functionality for progress tracking and result creation
 */
export abstract class BaseStepProcessor<TInput, TOutput> {
  protected abstract readonly logger: Logger;

  /**
   * Process the step with the given input
   * Must be implemented by concrete step processors
   */
  abstract process(input: TInput, job: Job<StepJobData>): Promise<TOutput>;

  /**
   * Create a successful step result
   */
  protected createResult(
    stepType: StepType,
    output: TOutput,
    startedAt: Date
  ): StepResult {
    return {
      stepType,
      status: 'completed',
      output,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
    };
  }

  /**
   * Create a failed step result
   */
  protected createFailedResult(
    stepType: StepType,
    error: string,
    startedAt: Date
  ): StepResult {
    return {
      stepType,
      status: 'failed',
      error,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}
