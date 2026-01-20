/**
 * Flow definition types for BullMQ FlowProducer
 * Shared across all flow builders
 */

import type {
  RenderStepType,
  DetectLabelsStepType,
  RecommendationStepType,
} from '../types/step.types';
import type { ParentJobData } from '../types/job.types';
import type {
  TaskTranscodeInput,
  TranscodeStepType,
} from '@project/shared/jobs';

/**
 * Child job options
 */
export interface ChildJobOpts {
  attempts: number;
  backoff: {
    type: 'exponential';
    delay: number;
  };
}

/**
 * Child job dependency reference
 */
export interface ChildJobDependency {
  name: string;
  queueName: string;
}

// ============================================================================
// Transcode Flow Types
// ============================================================================

export interface TranscodeFlowDefinition {
  name: string;
  queueName: string;
  data: ParentJobData;
  children: (TranscodeChildJobDefinition | FlowDefinition)[];
}

export interface TranscodeChildJobDefinition {
  name: TranscodeStepType;
  queueName: string;
  data: {
    taskId: string;
    workspaceId: string;
    stepType: TranscodeStepType;
    parentJobId: string;
    input: TaskTranscodeInput;
  };
  opts?: ChildJobOpts;
  children?: (ChildJobDependency | FlowDefinition)[];
}

// ============================================================================
// Render Flow Types
// ============================================================================

export interface RenderFlowDefinition {
  name: string;
  queueName: string;
  data: ParentJobData;
  children: (RenderChildJobDefinition | FlowDefinition)[];
}

export interface RenderChildJobDefinition {
  name: RenderStepType;
  queueName: string;
  data: {
    taskId: string;
    workspaceId: string;
    stepType: RenderStepType;
    parentJobId: string;
    input: any;
  };
  opts?: ChildJobOpts;
  children?: (ChildJobDependency | FlowDefinition)[];
}

// ============================================================================
// Labels Flow Types
// ============================================================================

export interface LabelsFlowDefinition {
  name: string;
  queueName: string;
  data: ParentJobData;
  children: (LabelsChildJobDefinition | FlowDefinition)[];
}

export interface LabelsChildJobDefinition {
  name: DetectLabelsStepType | RecommendationStepType;
  queueName: string;
  data: {
    taskId: string;
    workspaceId: string;
    stepType: DetectLabelsStepType | RecommendationStepType;
    parentJobId: string;
    input: any;
  };
  opts?: ChildJobOpts;
  children?: (ChildJobDependency | FlowDefinition)[];
}

// ============================================================================
// Recommendations Flow Types
// ============================================================================

export interface RecommendationsFlowDefinition {
  name: string;
  queueName: string;
  data: ParentJobData;
  children: (RecommendationsChildJobDefinition | FlowDefinition)[];
}

export interface RecommendationsChildJobDefinition {
  name: RecommendationStepType;
  queueName: string;
  data: {
    taskId: string;
    workspaceId: string;
    stepType: RecommendationStepType;
    parentJobId: string;
    input: any;
  };
  opts?: ChildJobOpts;
  children?: (ChildJobDependency | FlowDefinition)[];
}

// ============================================================================
// Union Types
// ============================================================================

export type FlowDefinition =
  | TranscodeFlowDefinition
  | RenderFlowDefinition
  | LabelsFlowDefinition
  | RecommendationsFlowDefinition;
