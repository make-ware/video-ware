import { RecommendationStrategy, Media } from '@project/shared';
import { BaseRecommendationStrategy } from './base-strategy';
import { ExpandedTimelineClip } from '@/types/expanded-types';
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
 * Supports cross-media comparison using mediaDate.
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
    const seed = context.seedClip;
    if (!seed) return [];

    const timeWindow =
      context.searchParams.timeWindow || this.DEFAULT_TIME_WINDOW;

    // Helper for absolute time
    const getAbsTime = (
      media: Media | string | null | undefined,
      offset: number
    ): number | null => {
      if (!media || typeof media !== 'object' || !media.mediaDate) return null;
      const t = new Date(media.mediaDate).getTime();
      return isNaN(t) ? null : t + offset * 1000;
    };

    const expandedSeed = seed as unknown as ExpandedTimelineClip;
    const seedMedia = expandedSeed.expand?.MediaRef || expandedSeed.MediaRef;
    const seedAbsStart = getAbsTime(seedMedia, seed.start);

    for (const c of context.availableClips) {
      if (c.id === seed.id) continue;
      const clip = c as unknown as ExpandedTimelineClip;

      let timeDelta = Infinity;

      // Case 1: Same Media
      if (clip.MediaRef === seed.MediaRef) {
        // Distance between ranges
        // dist(A, B) = max(0, startB - endA, startA - endB) usually, but here just center or min edge
        // Using min edge distance
        timeDelta = Math.min(
          Math.abs(clip.start - seed.start),
          Math.abs(clip.end - seed.end),
          Math.abs(clip.start - seed.end),
          Math.abs(clip.end - seed.start)
        );
      }
      // Case 2: Different Media (using dates)
      else if (seedAbsStart !== null) {
        const clipMedia = clip.expand?.MediaRef || clip.MediaRef;
        const clipAbsStart = getAbsTime(clipMedia, clip.start);

        if (clipAbsStart !== null) {
          const clipAbsEnd = clipAbsStart + clip.duration * 1000;
          const seedAbsEnd = seedAbsStart + seed.duration * 1000;

          // Calculate distance between time ranges in ms
          const startDist = Math.abs(clipAbsStart - seedAbsStart);
          const endDist = Math.abs(clipAbsEnd - seedAbsEnd);
          // Convert to seconds
          timeDelta = Math.min(startDist, endDist) / 1000;
        }
      }

      if (timeDelta <= timeWindow) {
        candidates.push({
          clipId: clip.id,
          score: 1 - timeDelta / timeWindow,
          reason: `Shot around the same time (${Math.round(timeDelta)}s)`,
          reasonData: { timeDelta },
        });
      }
    }

    return candidates;
  }
}
