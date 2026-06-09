/**
 * Step type enums for different task processing domains
 */

import {
  TranscodeStepType,
  RenderStepType,
  DetectLabelsStepType,
} from '@project/shared/jobs';

export { TranscodeStepType, RenderStepType, DetectLabelsStepType };

// Combined union type of all step types
export type StepType =
  | TranscodeStepType
  | RenderStepType
  | DetectLabelsStepType;
