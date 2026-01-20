import type { StepType } from './step.types';

/**
 * Task step data for tracking step progress in PocketBase
 */
export interface TaskStepData {
  steps: {
    [stepType: string]: {
      status: 'pending' | 'running' | 'completed' | 'failed';
      jobId?: string;
      progress: number;
      output?: unknown;
      error?: string;
      startedAt?: string;
      completedAt?: string;
    };
  };
  currentStep?: string;
  completedSteps: string[];
  failedSteps: string[];
}

/**
 * Base interface for step-specific result types
 */
export interface BaseStepResult {
  stepType: StepType;
  status: 'completed' | 'failed';
  startedAt: string;
  completedAt: string;
}

/**
 * Result from a successful step execution
 */
export interface SuccessStepResult<TOutput = unknown> extends BaseStepResult {
  status: 'completed';
  output: TOutput;
}

/**
 * Result from a failed step execution
 */
export interface FailedStepResult extends BaseStepResult {
  status: 'failed';
  error: string;
}

/**
 * Union type for step results
 */
export type StepExecutionResult<TOutput = unknown> =
  | SuccessStepResult<TOutput>
  | FailedStepResult;
