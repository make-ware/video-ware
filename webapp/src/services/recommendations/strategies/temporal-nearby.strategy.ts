import { RecommendationStrategy } from '@project/shared';
import { BaseRecommendationStrategy } from './base-strategy';
import type {
  MediaStrategyContext,
  ScoredMediaCandidate,
  ScoredTimelineCandidate,
  TimelineStrategyContext,
  SearchParams,
} from '../types';
import { LabelType } from '@project/shared';

/**
 * Temporal Nearby Strategy
 *
 * Recommends segments/clips within a configurable time window of the seed clip.
 */
export class TemporalNearbyStrategy extends BaseRecommendationStrategy {
  readonly name = RecommendationStrategy.TEMPORAL_NEARBY;

  private readonly DEFAULT_TIME_WINDOW = 60;

  async executeForMedia(
    context: MediaStrategyContext
  ): Promise<ScoredMediaCandidate[]> {
    const candidates: ScoredMediaCandidate[] = [];
    const timeWindow =
      (context.filterParams as SearchParams).timeWindow ||
      this.DEFAULT_TIME_WINDOW;

    const allDetections = [
      ...context.labelFaces.map((f) => ({
        ...f,
        labelType: LabelType.FACE,
        confidence: f.avgConfidence,
      })),
      ...context.labelPeople.map((p) => ({
        ...p,
        labelType: LabelType.PERSON,
      })),
      ...context.labelObjects.map((o) => ({
        ...o,
        labelType: LabelType.OBJECT,
      })),
    ];

    const sortedDetections = [...allDetections].sort(
      (a, b) => a.start - b.start
    );

    for (let i = 0; i < sortedDetections.length; i++) {
      const det = sortedDetections[i];

      if (
        !this.passesFilters(
          {
            start: det.start,
            end: det.end,
            confidence: det.confidence,
            labelType: det.labelType,
          },
          context.filterParams
        )
      ) {
        continue;
      }

      const nearbyDetections = sortedDetections.filter((other, j) => {
        if (i === j) return false;
        const timeDelta = Math.abs(other.start - det.start);
        return timeDelta <= timeWindow;
      });

      if (nearbyDetections.length > 0) {
        const matchingClip = context.existingClips.find(
          (mc) =>
            Math.abs(mc.start - det.start) < 0.1 &&
            Math.abs(mc.end - det.end) < 0.1
        );

        const avgTimeDelta =
          nearbyDetections.reduce(
            (sum, other) => sum + Math.abs(other.start - det.start),
            0
          ) / nearbyDetections.length;
        const score = Math.min(
          1,
          (det.confidence + (1 - avgTimeDelta / timeWindow)) / 2
        );

        candidates.push({
          start: det.start,
          end: det.end,
          clipId: matchingClip?.id,
          score,
          reason: `TemporalCluster`,
          reasonData: {
            timeDelta: avgTimeDelta,
            nearbyCount: nearbyDetections.length,
            type: det.labelType,
          },
          labelType: det.labelType,
        });
      }
    }

    return candidates;
  }

  async executeForTimeline(
    context: TimelineStrategyContext
  ): Promise<ScoredTimelineCandidate[]> {
    const candidates: ScoredTimelineCandidate[] = [];
    if (!context.seedClip) return [];

    const timeWindow =
      context.searchParams.timeWindow || this.DEFAULT_TIME_WINDOW;

    for (const clip of context.availableClips) {
      if (clip.id === context.seedClip.id) continue;
      if (clip.MediaRef !== context.seedClip.MediaRef) continue;

      const timeDelta = Math.min(
        Math.abs(clip.start - context.seedClip.start),
        Math.abs(clip.end - context.seedClip.end)
      );

      if (timeDelta > timeWindow) continue;

      candidates.push({
        clipId: clip.id,
        score: 1 - timeDelta / timeWindow,
        reason: `Within ${Math.round(timeDelta)}s of seed clip`,
        reasonData: { timeDelta },
      });
    }

    return candidates;
  }
}
