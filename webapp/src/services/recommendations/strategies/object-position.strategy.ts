import { RecommendationStrategy, LabelType } from '@project/shared';
import { BaseRecommendationStrategy } from './base-strategy';
import type {
  MediaStrategyContext,
  ScoredMediaCandidate,
  ScoredTimelineCandidate,
  TimelineStrategyContext,
} from '../types';

interface BoundingBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Keyframe {
  timeOffset: number;
  boundingBox?: BoundingBox;
  confidence?: number;
}

export class ObjectPositionStrategy extends BaseRecommendationStrategy {
  readonly name = RecommendationStrategy.OBJECT_POSITION_MATCHER;

  async executeForMedia(
    context: MediaStrategyContext
  ): Promise<ScoredMediaCandidate[]> {
    const { labelTracks, filterParams } = context;
    const candidates: ScoredMediaCandidate[] = [];

    // Generic "Object" recommendations without specific label names
    for (const track of labelTracks) {
      if (track.confidence < (filterParams.minConfidence || 0.4)) continue;

      let score = track.confidence;
      if (track.duration > 2) {
        score *= 1.1;
      }

      // Generic reason to avoid flakey label names
      const reason = `Prominent object track`;

      // Apply filters (we still use labelType internally for filtering if user asked for objects,
      // but we don't expose the specific class name in the reason)
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
          // labelEntityRef: track.LabelEntityRef, // Optional: exclude if we want to be fully opaque
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

    // 1. Identify the target object/region from the seed clip
    // Look at the very end of the seed clip for continuity
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

    // Get the bounding box at the END of the seed clip
    const targetKeyframes =
      (targetTrack.keyframes as unknown as Keyframe[]) || [];
    let targetBox: BoundingBox | undefined =
      targetTrack.boundingBox as unknown as BoundingBox;

    if (targetKeyframes.length > 0) {
      const seedEndTime = seedClip.end;
      // Find the keyframe closest to the cut point (track start + timeOffset ~= seed end)
      const targetOffset = seedEndTime - targetTrack.start;

      // Find closest keyframe
      let bestFrame: Keyframe | null = null;
      let minDiff = Infinity;

      for (const kf of targetKeyframes) {
        const diff = Math.abs(kf.timeOffset - targetOffset);
        if (diff < minDiff) {
          minDiff = diff;
          bestFrame = kf;
        }
      }

      if (bestFrame && bestFrame.boundingBox) {
        targetBox = bestFrame.boundingBox;
      }
    }

    if (!targetBox) return [];

    const candidates: ScoredTimelineCandidate[] = [];

    // 2. Scan all available clips (deep seek) for matching spatial position
    for (const clip of availableClips) {
      if (clip.id === seedClip.id) continue;

      // Find tracks in this clip
      const clipTracks = labelTracks.filter(
        (t) => t.MediaRef === clip.MediaRef
      );

      let bestMatchScore = 0;
      let bestMatchTime = 0;

      for (const track of clipTracks) {
        // Optimization: Skip tracks that don't overlap with the clip
        if (track.end < clip.start || track.start > clip.end) continue;

        const keyframes = (track.keyframes as unknown as Keyframe[]) || [];

        // Fallback if no keyframes: use summary box
        if (keyframes.length === 0) {
          const summaryBox = track.boundingBox as unknown as BoundingBox;
          if (summaryBox) {
            const score = this.calculateIoU(targetBox, summaryBox);
            if (score > bestMatchScore) {
              bestMatchScore = score;
              // Best guess for time is the start of the overlap between track and clip
              bestMatchTime = Math.max(clip.start, track.start);
            }
          }
          continue;
        }

        // Deep seek through keyframes
        for (const kf of keyframes) {
          if (!kf.boundingBox) continue;

          const absTime = track.start + kf.timeOffset;

          // Ensure we are within the clip's bounds
          if (absTime < clip.start || absTime > clip.end) continue;

          const score = this.calculateIoU(targetBox, kf.boundingBox);

          if (score > bestMatchScore) {
            bestMatchScore = score;
            bestMatchTime = absTime;
          }
        }
      }

      // Threshold for recommendation
      if (bestMatchScore > 0.3) {
        // Lowered threshold for IoU as precise matches are rare
        candidates.push({
          clipId: clip.id,
          score: bestMatchScore,
          reason: `Spatial match (${(bestMatchScore * 100).toFixed(0)}% overlap)`,
          reasonData: {
            matchTime: bestMatchTime,
            score: bestMatchScore,
            targetTrackId: targetTrack.trackId,
          },
        });
      }
    }

    return candidates;
  }

  private calculateIoU(box1: BoundingBox, box2: BoundingBox): number {
    // Validate boxes
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

    const xA = Math.max(box1.left, box2.left);
    const yA = Math.max(box1.top, box2.top);
    const xB = Math.min(box1.right, box2.right);
    const yB = Math.min(box1.bottom, box2.bottom);

    const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
    if (interArea === 0) return 0;

    const box1Area = (box1.right - box1.left) * (box1.bottom - box1.top);
    const box2Area = (box2.right - box2.left) * (box2.bottom - box2.top);

    const unionArea = box1Area + box2Area - interArea;
    if (unionArea === 0) return 0;

    return interArea / unionArea;
  }

  // Fallback to spatial similarity (center distance) if needed,
  // but IoU is requested ("exact overlap").
}
