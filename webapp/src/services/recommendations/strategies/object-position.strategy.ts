import { RecommendationStrategy, LabelType } from '@project/shared';
import { BaseRecommendationStrategy } from './base-strategy';
import type {
  MediaStrategyContext,
  ScoredMediaCandidate,
  ScoredTimelineCandidate,
  TimelineStrategyContext,
} from '../types';

export class ObjectPositionStrategy extends BaseRecommendationStrategy {
  readonly name = RecommendationStrategy.OBJECT_POSITION_MATCHER;

  async executeForMedia(
    context: MediaStrategyContext
  ): Promise<ScoredMediaCandidate[]> {
    const { labelTracks, filterParams } = context;
    const candidates: ScoredMediaCandidate[] = [];

    for (const track of labelTracks) {
      if (track.confidence < (filterParams.minConfidence || 0.5)) continue;

      // Score based on duration and confidence
      // Prefer tracks that are reasonably long (> 2s)
      let score = track.confidence;
      if (track.duration > 2) {
        score *= 1.1;
      }

      const reason = `Prominent object track (ID: ${track.trackId})`;

      // Apply filters
      if (
        !this.passesFilters(
          {
            start: track.start,
            end: track.end,
            confidence: track.confidence,
            labelType: LabelType.OBJECT,
          },
          filterParams
        )
      ) {
        continue;
      }

      candidates.push({
        start: track.start,
        end: track.end,
        score: this.normalizeScore(score, 0, 1.1),
        reason,
        reasonData: {
          trackId: track.trackId,
          labelEntityRef: track.LabelEntityRef,
          duration: track.duration,
        },
        labelType: LabelType.OBJECT,
      });
    }

    return candidates;
  }

  async executeForTimeline(
    context: TimelineStrategyContext
  ): Promise<ScoredTimelineCandidate[]> {
    const { seedClip, availableClips, labelTracks } = context;

    if (!seedClip) return [];

    // Find tracks in seed clip active near the end (for continuity)
    // Looking at the last 1 second of the seed clip
    const seedEndWindowStart = Math.max(0, seedClip.end - 1);
    const seedTracks = labelTracks.filter(
      (t) =>
        t.MediaRef === seedClip.MediaRef &&
        t.end >= seedEndWindowStart &&
        t.start <= seedClip.end
    );

    if (seedTracks.length === 0) return [];

    // Select the most prominent track (highest confidence)
    const targetTrack = seedTracks.sort(
      (a, b) => b.confidence - a.confidence
    )[0];

    // Attempt to get the bounding box.
    // Uses the track summary boundingBox if available, or first keyframe as fallback logic
    // (Actual logic relies on data availability)
    const targetBox = targetTrack.boundingBox as
      | Record<string, number>
      | undefined;

    if (!targetBox) return [];

    const candidates: ScoredTimelineCandidate[] = [];

    for (const clip of availableClips) {
      if (clip.id === seedClip.id) continue;

      // Find tracks in candidate clip active near the start
      // Looking at the first 1 second
      const clipStartWindowEnd = clip.start + 1;
      const candidateTracks = labelTracks.filter(
        (t) =>
          t.MediaRef === clip.MediaRef &&
          t.start <= clipStartWindowEnd &&
          t.end >= clip.start
      );

      for (const track of candidateTracks) {
        const trackBox = track.boundingBox as
          | Record<string, number>
          | undefined;
        if (!trackBox) continue;

        // Calculate spatial similarity (center distance)
        const score = this.calculateSpatialSimilarity(targetBox, trackBox);

        if (score > 0.6) {
          candidates.push({
            clipId: clip.id,
            score,
            reason: `Spatial match with seed object (${(score * 100).toFixed(0)}%)`,
            reasonData: {
              score,
              targetTrackId: targetTrack.trackId,
              matchTrackId: track.trackId,
            },
          });
        }
      }
    }

    return candidates;
  }

  private calculateSpatialSimilarity(
    box1: Record<string, number>,
    box2: Record<string, number>
  ): number {
    // Expects { top, left, bottom, right } normalized 0-1
    // If undefined properties, return 0
    if (
      box1.left === undefined ||
      box1.right === undefined ||
      box1.top === undefined ||
      box1.bottom === undefined ||
      box2.left === undefined ||
      box2.right === undefined ||
      box2.top === undefined ||
      box2.bottom === undefined
    ) {
      return 0;
    }

    const c1x = (box1.left + box1.right) / 2;
    const c1y = (box1.top + box1.bottom) / 2;
    const c2x = (box2.left + box2.right) / 2;
    const c2y = (box2.top + box2.bottom) / 2;

    const dist = Math.sqrt(Math.pow(c1x - c2x, 2) + Math.pow(c1y - c2y, 2));
    // Max possible distance in unit square is sqrt(2) approx 1.414
    // We want 1 for dist=0, 0 for dist=large

    return Math.max(0, 1 - dist);
  }
}
