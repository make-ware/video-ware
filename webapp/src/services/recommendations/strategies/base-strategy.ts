import type { LabelType } from '@project/shared';
import type {
  FilterParams,
  IRecommendationStrategy,
  MediaStrategyContext,
  ScoredMediaCandidate,
  ScoredTimelineCandidate,
  TimelineStrategyContext,
} from '../types';
import type { RecommendationStrategy } from '@project/shared';

/**
 * Abstract base class for recommendation strategies
 */
export abstract class BaseRecommendationStrategy implements IRecommendationStrategy {
  abstract readonly name: RecommendationStrategy;

  abstract executeForMedia(
    context: MediaStrategyContext
  ): Promise<ScoredMediaCandidate[]>;

  abstract executeForTimeline(
    context: TimelineStrategyContext
  ): Promise<ScoredTimelineCandidate[]>;

  /**
   * Helper: Check if a segment passes filter criteria
   */
  protected passesFilters(
    segment: {
      start: number;
      end: number;
      confidence: number;
      labelType: LabelType;
    },
    filters: FilterParams
  ): boolean {
    // Label type filter
    if (filters.labelTypes && filters.labelTypes.length > 0) {
      if (!filters.labelTypes.includes(segment.labelType)) {
        return false;
      }
    }

    // Confidence filter
    if (filters.minConfidence !== undefined) {
      if (segment.confidence < filters.minConfidence) {
        return false;
      }
    }

    // Duration range filter
    if (filters.durationRange) {
      const duration = segment.end - segment.start;
      if (
        duration < filters.durationRange.min ||
        duration > filters.durationRange.max
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Helper: Normalize score to 0-1 range
   */
  protected normalizeScore(score: number, min: number, max: number): number {
    if (max === min) return 1;
    return Math.max(0, Math.min(1, (score - min) / (max - min)));
  }
}
