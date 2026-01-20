/**
 * Step type enums for different task processing domains
 */

import {
  TranscodeStepType,
  RenderStepType,
  DetectLabelsStepType,
  RecommendationStepType,
} from '@project/shared/jobs';

export {
  TranscodeStepType,
  RenderStepType,
  DetectLabelsStepType,
  RecommendationStepType,
};

// Combined union type of all step types
export type StepType =
  | TranscodeStepType
  | RenderStepType
  | DetectLabelsStepType
  | RecommendationStepType;
