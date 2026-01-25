import { RecommendationStrategy, LabelType, Media } from '@project/shared';
import { BaseRecommendationStrategy } from './base-strategy';
import { ExpandedTimelineClip } from '@/types/expanded-types';
import type {
  MediaStrategyContext,
  ScoredMediaCandidate,
  ScoredTimelineCandidate,
  TimelineStrategyContext,
} from '../types';

/**
 * Temporal Continuity Strategy
 *
 * Recommends clips that immediately follow the seed clip in time.
 * Considers both:
 * 1. Continuity within the same media file.
 * 2. Continuity across different media files using mediaDate (absolute time).
 */
export class TemporalContinuityStrategy extends BaseRecommendationStrategy {
  readonly name = RecommendationStrategy.ADJACENT_SHOT;

  async executeForMedia(
    context: MediaStrategyContext
  ): Promise<ScoredMediaCandidate[]> {
    const candidates: ScoredMediaCandidate[] = [];
    // For single-media context, we recommend segments that are adjacent to the current shots.
    // This preserves the utility of "Adjacent Shot" for the media editor.

    const shotClips = context.labelShots;
    if (shotClips.length === 0) return candidates;

    const sortedShots = [...shotClips].sort((a, b) => a.start - b.start);

    for (let i = 0; i < sortedShots.length; i++) {
      const currentShot = sortedShots[i];

      if (
        !this.passesFilters(
          {
            start: currentShot.start,
            end: currentShot.end,
            confidence: currentShot.confidence,
            labelType: LabelType.SHOT,
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
          reason: `Previous segment`,
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
          reason: `Next segment`,
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

    const seed = context.seedClip as unknown as ExpandedTimelineClip;
    // Access expanded MediaRef.
    // Note: The type definition might not include 'expand', but the runtime object from mutator does.
    const seedMedia = seed.expand?.MediaRef || seed.MediaRef;

    const getAbsTime = (
      media: Media | string | null | undefined,
      offsetSeconds: number
    ): number | null => {
      if (!media || typeof media !== 'object' || !media.mediaDate) return null;
      const base = new Date(media.mediaDate).getTime();
      if (isNaN(base)) return null;
      return base + offsetSeconds * 1000;
    };

    const seedAbsEnd = getAbsTime(seedMedia, seed.end);

    for (const c of context.availableClips) {
      if (c.id === seed.id) continue;
      const clip = c as unknown as ExpandedTimelineClip;

      const clipMedia = clip.expand?.MediaRef || clip.MediaRef;

      let score = 0;
      let reason = '';
      let timeGap = 0;

      // Case 1: Same Media (Local Continuity)
      // Note: Comparing MediaRef string IDs
      if (clip.MediaRef === seed.MediaRef) {
        const gap = clip.start - seed.end;
        // Allow slight overlap (-0.5s) or small gap (< 10s)
        if (gap >= -0.5 && gap < 10) {
          score = 1.0 - Math.max(0, gap) / 20; // Decay
          reason =
            gap <= 0.1
              ? 'Continues immediately'
              : `Follows after ${gap.toFixed(1)}s`;
          timeGap = gap;
        }
      }
      // Case 2: Different Media (Global/Absolute Continuity)
      else if (seedAbsEnd !== null) {
        const clipAbsStart = getAbsTime(clipMedia, clip.start);
        if (clipAbsStart !== null) {
          const gapMs = clipAbsStart - seedAbsEnd;
          const gapSec = gapMs / 1000;

          // Check for immediate succession across files
          // Allow gap up to 60 seconds (maybe cameras stopped/started)
          // Also allow slight negative gap (overlap in recording)
          if (gapSec >= -5 && gapSec < 60) {
            score = 0.9 - Math.max(0, Math.abs(gapSec)) / 100;
            reason = `Timeline continues (Gap: ${gapSec.toFixed(1)}s)`;
            timeGap = gapSec;
          }
        }
      }

      if (score > 0) {
        candidates.push({
          clipId: clip.id,
          score,
          reason,
          reasonData: {
            timeGap,
            sameMedia: clip.MediaRef === seed.MediaRef,
            absContinuity: clip.MediaRef !== seed.MediaRef,
          },
        });
      }
    }

    return candidates;
  }
}
