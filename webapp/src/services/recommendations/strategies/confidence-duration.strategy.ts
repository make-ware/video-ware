import { RecommendationStrategy } from '@project/shared';
import { BaseRecommendationStrategy } from './base-strategy';
import type {
  MediaStrategyContext,
  ScoredMediaCandidate,
  ScoredTimelineCandidate,
  TimelineStrategyContext,
} from '../types';
import { LabelType } from '@project/shared';

/**
 * Confidence Duration Strategy
 *
 * Recommends segments/clips with high confidence labels and similar duration to the seed.
 */
export class ConfidenceDurationStrategy extends BaseRecommendationStrategy {
  readonly name = RecommendationStrategy.CONFIDENCE_DURATION;

  private readonly HIGH_CONFIDENCE_THRESHOLD = 0.7;
  private readonly MAX_DURATION_DELTA = 5.0;

  async executeForMedia(
    context: MediaStrategyContext
  ): Promise<ScoredMediaCandidate[]> {
    const candidates: ScoredMediaCandidate[] = [];

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

    const highConfidenceDetections = allDetections.filter(
      (d) => d.confidence >= this.HIGH_CONFIDENCE_THRESHOLD
    );

    for (const det of highConfidenceDetections) {
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

      const matchingClip = context.existingClips.find(
        (mc) =>
          Math.abs(mc.start - det.start) < 0.1 &&
          Math.abs(mc.end - det.end) < 0.1
      );

      candidates.push({
        start: det.start,
        end: det.end,
        clipId: matchingClip?.id,
        score: det.confidence,
        reason: `${det.labelType}Detection`,
        reasonData: { confidence: det.confidence, type: det.labelType },
        labelType: det.labelType,
      });
    }

    return candidates;
  }

  async executeForTimeline(
    context: TimelineStrategyContext
  ): Promise<ScoredTimelineCandidate[]> {
    const candidates: ScoredTimelineCandidate[] = [];
    const seedDuration = context.seedClip
      ? context.seedClip.end - context.seedClip.start
      : null;

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

    for (const clip of context.availableClips) {
      if (context.seedClip && clip.id === context.seedClip.id) continue;

      const candidateDetections = allDetections.filter(
        (d) =>
          d.MediaRef === clip.MediaRef &&
          d.start >= clip.start &&
          d.end <= clip.end
      );

      if (candidateDetections.length === 0) continue;

      const avgConfidence =
        candidateDetections.reduce((sum, d) => sum + d.confidence, 0) /
        candidateDetections.length;
      if (avgConfidence < this.HIGH_CONFIDENCE_THRESHOLD) continue;

      let durationScore = 1.0;
      if (seedDuration !== null) {
        const clipDuration = clip.end - clip.start;
        const durationDelta = Math.abs(clipDuration - seedDuration);
        durationScore = Math.max(
          0,
          1 - durationDelta / this.MAX_DURATION_DELTA
        );
      }

      candidates.push({
        clipId: clip.id,
        score: (avgConfidence + durationScore) / 2,
        reason: `High confidence and similar duration`,
        reasonData: { confidence: avgConfidence, durationScore },
      });
    }

    return candidates;
  }
}
