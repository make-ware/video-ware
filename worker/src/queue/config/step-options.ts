import { TranscodeStepType } from '@project/shared';
import {
  RenderStepType,
  DetectLabelsStepType,
  RecommendationStepType,
} from '../types/step.types';

/**
 * Job options configuration for each step type
 * Defines retry attempts and exponential backoff delays
 */
export interface StepJobOptions {
  attempts: number;
  backoff: {
    type: 'exponential';
    delay: number;
  };
}

const DEFAULT_OPTIONS: StepJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 30000,
  },
};

/**
 * Step-specific job options with retry and backoff configuration
 */
export const STEP_JOB_OPTIONS: Record<string, StepJobOptions> = {
  // Transcode steps
  [TranscodeStepType.PROBE]: DEFAULT_OPTIONS,
  [TranscodeStepType.THUMBNAIL]: DEFAULT_OPTIONS,
  [TranscodeStepType.SPRITE]: DEFAULT_OPTIONS,
  [TranscodeStepType.FILMSTRIP]: DEFAULT_OPTIONS,
  [TranscodeStepType.TRANSCODE]: DEFAULT_OPTIONS,

  // Render steps
  [RenderStepType.PREPARE]: DEFAULT_OPTIONS,
  [RenderStepType.EXECUTE]: DEFAULT_OPTIONS,
  [RenderStepType.FINALIZE]: DEFAULT_OPTIONS,

  // Detect Labels steps
  [DetectLabelsStepType.UPLOAD_TO_GCS]: DEFAULT_OPTIONS,

  // Recommendation steps
  [RecommendationStepType.GENERATE_MEDIA_RECOMMENDATIONS]: DEFAULT_OPTIONS,
  [RecommendationStepType.GENERATE_TIMELINE_RECOMMENDATIONS]: DEFAULT_OPTIONS,
};

/**
 * Get job options for a specific step type
 * Returns default options if step type is not configured
 */
export function getStepJobOptions(stepType: string): StepJobOptions {
  return STEP_JOB_OPTIONS[stepType] || DEFAULT_OPTIONS;
}
