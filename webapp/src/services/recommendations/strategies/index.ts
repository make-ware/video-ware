import { RecommendationStrategy } from '@project/shared';
import type {
  IRecommendationStrategy,
  ScoredMediaCandidate,
  ScoredTimelineCandidate,
} from '../types';
import { SameEntityStrategy } from './same-entity.strategy';
import { AdjacentShotStrategy } from './adjacent-shot.strategy';
import { TemporalNearbyStrategy } from './temporal-nearby.strategy';
import { ConfidenceDurationStrategy } from './confidence-duration.strategy';
import { DialogClusterStrategy } from './dialog-cluster.strategy';
import { ObjectPositionStrategy } from './object-position.strategy';
import { ActivityStrategy } from './activity.strategy';

/**
 * Strategy Registry
 */
export class StrategyRegistry {
  private strategies: Map<RecommendationStrategy, IRecommendationStrategy> =
    new Map();

  constructor() {
    this.register(new SameEntityStrategy());
    this.register(new AdjacentShotStrategy());
    this.register(new TemporalNearbyStrategy());
    this.register(new ConfidenceDurationStrategy());
    this.register(new DialogClusterStrategy());
    this.register(new ObjectPositionStrategy());
    this.register(new ActivityStrategy());
  }

  register(strategy: IRecommendationStrategy) {
    this.strategies.set(strategy.name, strategy);
  }

  get(name: RecommendationStrategy): IRecommendationStrategy | undefined {
    return this.strategies.get(name);
  }

  getAll(): IRecommendationStrategy[] {
    return Array.from(this.strategies.values());
  }
}

/**
 * Simple Score Combiner
 */
export class ScoreCombiner {
  combineMediaCandidates(
    candidatesByStrategy: Map<RecommendationStrategy, ScoredMediaCandidate[]>
  ): ScoredMediaCandidate[] {
    const combined = new Map<string, ScoredMediaCandidate>();

    for (const [strategy, candidates] of candidatesByStrategy.entries()) {
      for (const cand of candidates) {
        const key = `${cand.start}-${cand.end}`;
        if (!combined.has(key)) {
          combined.set(key, {
            ...cand,
            strategy,
            reasonData: {
              ...cand.reasonData,
              combinedStrategies: [strategy],
              individualScores: { [strategy]: cand.score },
            },
          });
        } else {
          const existing = combined.get(key)!;
          // Weighted average or max (simplified for now)
          existing.score = (existing.score + cand.score) / 2;
          existing.reason = `${existing.reason}; ${cand.reason}`.substring(
            0,
            2000
          );
          const combinedStrategies = new Set(
            (existing.reasonData
              .combinedStrategies as RecommendationStrategy[]) || []
          );
          combinedStrategies.add(strategy);

          const individualScores = {
            ...(existing.reasonData.individualScores as Record<string, number>),
            [strategy]: cand.score,
          };

          let bestStrategy = existing.strategy;
          const bestScore = bestStrategy
            ? individualScores[bestStrategy]
            : undefined;

          if (bestScore === undefined || cand.score > bestScore) {
            bestStrategy = strategy;
          }

          existing.strategy = bestStrategy;
          existing.reasonData = {
            ...existing.reasonData,
            combinedStrategies: Array.from(combinedStrategies),
            individualScores,
          };
        }
      }
    }

    return Array.from(combined.values());
  }

  combineTimelineCandidates(
    candidatesByStrategy: Map<RecommendationStrategy, ScoredTimelineCandidate[]>
  ): ScoredTimelineCandidate[] {
    const combined = new Map<string, ScoredTimelineCandidate>();

    for (const [strategy, candidates] of candidatesByStrategy.entries()) {
      for (const cand of candidates) {
        if (!combined.has(cand.clipId)) {
          combined.set(cand.clipId, {
            ...cand,
            strategy,
            reasonData: {
              ...cand.reasonData,
              combinedStrategies: [strategy],
              individualScores: { [strategy]: cand.score },
            },
          });
        } else {
          const existing = combined.get(cand.clipId)!;
          existing.score = (existing.score + cand.score) / 2;
          existing.reason = `${existing.reason}; ${cand.reason}`.substring(
            0,
            2000
          );
          const combinedStrategies = new Set(
            (existing.reasonData
              .combinedStrategies as RecommendationStrategy[]) || []
          );
          combinedStrategies.add(strategy);

          const individualScores = {
            ...(existing.reasonData.individualScores as Record<string, number>),
            [strategy]: cand.score,
          };

          let bestStrategy = existing.strategy;
          const bestScore = bestStrategy
            ? individualScores[bestStrategy]
            : undefined;

          if (bestScore === undefined || cand.score > bestScore) {
            bestStrategy = strategy;
          }

          existing.strategy = bestStrategy;
          existing.reasonData = {
            ...existing.reasonData,
            combinedStrategies: Array.from(combinedStrategies),
            individualScores,
          };
        }
      }
    }

    return Array.from(combined.values());
  }
}

export * from './base-strategy';
export * from './same-entity.strategy';
export * from './adjacent-shot.strategy';
export * from './temporal-nearby.strategy';
export * from './confidence-duration.strategy';
export * from './dialog-cluster.strategy';
export * from './object-position.strategy';
export * from './activity.strategy';
