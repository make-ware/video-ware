import { RecommendationStrategy, LabelType } from '@project/shared';
import { BaseRecommendationStrategy } from './base-strategy';
import type {
  MediaStrategyContext,
  ScoredMediaCandidate,
  ScoredTimelineCandidate,
  TimelineStrategyContext,
} from '../types';

/**
 * Adjacent Shot Strategy
 *
 * Recommends segments/clips that are temporally adjacent (immediately before or after)
 * in the shot sequence.
 */
export class AdjacentShotStrategy extends BaseRecommendationStrategy {
  readonly name = RecommendationStrategy.ADJACENT_SHOT;

  async executeForMedia(
    context: MediaStrategyContext
  ): Promise<ScoredMediaCandidate[]> {
    const candidates: ScoredMediaCandidate[] = [];

    const shotClips = context.labelShots;

    if (shotClips.length === 0) return candidates;

    const sortedShots = [...shotClips].sort((a, b) => a.start - b.start);

    for (let i = 0; i < sortedShots.length; i++) {
      const currentShot = sortedShots[i];
      const labelType = LabelType.SHOT;

      if (
        !this.passesFilters(
          {
            start: currentShot.start,
            end: currentShot.end,
            confidence: currentShot.confidence,
            labelType: labelType as LabelType,
          },
          context.filterParams
        )
      ) {
        continue;
      }

      // Previous shot
      if (i > 0) {
        const prevShot = sortedShots[i - 1];
        const matchingClip = context.existingClips.find(
          (mc) =>
            Math.abs(mc.start - prevShot.start) < 0.1 &&
            Math.abs(mc.end - prevShot.end) < 0.1
        );

        candidates.push({
          start: prevShot.start,
          end: prevShot.end,
          clipId: matchingClip?.id,
          score: prevShot.confidence,
          reason: `Shot immediately before`,
          reasonData: { direction: 'previous', shotIndex: i - 1 },
          labelType: LabelType.SHOT,
        });
      }

      // Next shot
      if (i < sortedShots.length - 1) {
        const nextShot = sortedShots[i + 1];
        const matchingClip = context.existingClips.find(
          (mc) =>
            Math.abs(mc.start - nextShot.start) < 0.1 &&
            Math.abs(mc.end - nextShot.end) < 0.1
        );

        candidates.push({
          start: nextShot.start,
          end: nextShot.end,
          clipId: matchingClip?.id,
          score: nextShot.confidence,
          reason: `Shot immediately after`,
          reasonData: { direction: 'next', shotIndex: i + 1 },
          labelType: LabelType.SHOT,
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

    const seedShotClips = context.labelShots.filter((lc) => {
      return (
        lc.MediaRef === context.seedClip!.MediaRef &&
        lc.start >= context.seedClip!.start &&
        lc.end <= context.seedClip!.end
      );
    });

    if (seedShotClips.length === 0) return candidates;

    const allShotClips = context.labelShots
      .filter((lc) => {
        return lc.MediaRef === context.seedClip!.MediaRef;
      })
      .sort((a, b) => a.start - b.start);

    for (const seedShot of seedShotClips) {
      const shotIndex = allShotClips.findIndex((s) => s.id === seedShot.id);
      if (shotIndex === -1) continue;

      const adjacentIndices = [shotIndex - 1, shotIndex + 1].filter(
        (idx) => idx >= 0 && idx < allShotClips.length
      );

      for (const idx of adjacentIndices) {
        const adjacentShot = allShotClips[idx];
        const direction = idx < shotIndex ? 'previous' : 'next';

        for (const clip of context.availableClips) {
          if (
            clip.MediaRef === adjacentShot.MediaRef &&
            clip.start <= adjacentShot.start &&
            clip.end >= adjacentShot.end
          ) {
            if (candidates.some((c) => c.clipId === clip.id)) continue;

            candidates.push({
              clipId: clip.id,
              score: adjacentShot.confidence,
              reason: `Contains ${direction} shot in sequence`,
              reasonData: { direction, shotIndex: idx },
            });
          }
        }
      }
    }

    return candidates;
  }
}
