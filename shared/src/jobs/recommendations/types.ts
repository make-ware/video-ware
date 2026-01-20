/**
 * Recommendations job types
 * Defines step types, input types, and output types for recommendation jobs
 */

import type {
  RecommendationStrategy,
  LabelType,
  RecommendationTargetMode,
} from '../../enums.js';

/**
 * Recommendation step type enum
 */
export enum RecommendationStepType {
  GENERATE_MEDIA_RECOMMENDATIONS = 'recommendations:generate_media',
  GENERATE_TIMELINE_RECOMMENDATIONS = 'recommendations:generate_timeline',
}

/**
 * Input for GENERATE_MEDIA_RECOMMENDATIONS step
 */
export interface TaskRecommendationGenerateMediaStep {
  type: 'generate_media';
  workspaceId: string;
  mediaId: string;
  strategies: RecommendationStrategy[];
  strategyWeights?: Record<RecommendationStrategy, number>;
  filterParams?: {
    labelTypes?: LabelType[];
    minConfidence?: number;
    durationRange?: { min: number; max: number };
  };
  maxResults?: number;
}

/**
 * Input for GENERATE_TIMELINE_RECOMMENDATIONS step
 */
export interface TaskRecommendationGenerateTimelineStep {
  type: 'generate_timeline';
  workspaceId: string;
  timelineId: string;
  seedClipId?: string;
  targetMode: RecommendationTargetMode;
  strategies: RecommendationStrategy[];
  strategyWeights?: Record<RecommendationStrategy, number>;
  searchParams?: {
    labelTypes?: LabelType[];
    minConfidence?: number;
    durationRange?: { min: number; max: number };
    timeWindow?: number;
  };
  maxResults?: number;
}

/**
 * Union type for all recommendation step inputs
 */
export type TaskRecommendationInput =
  | TaskRecommendationGenerateMediaStep
  | TaskRecommendationGenerateTimelineStep;

/**
 * Output for media recommendations
 */
export interface TaskRecommendationGenerateMediaResult {
  generated: number;
  pruned: number;
  queryHash: string;
}

/**
 * Output for timeline recommendations
 */
export interface TaskRecommendationGenerateTimelineResult {
  generated: number;
  pruned: number;
  queryHash: string;
}

/**
 * Union type for all recommendation step outputs
 */
export type TaskRecommendationResult =
  | TaskRecommendationGenerateMediaResult
  | TaskRecommendationGenerateTimelineResult;
