import {
  RecommendationStrategy,
  LabelType,
  type LabelSpeech,
} from '@project/shared';
import { BaseRecommendationStrategy } from './base-strategy';
import type {
  MediaStrategyContext,
  ScoredMediaCandidate,
  ScoredTimelineCandidate,
  TimelineStrategyContext,
} from '../types';

export class DialogClusterStrategy extends BaseRecommendationStrategy {
  readonly name = RecommendationStrategy.DIALOG_CLUSTER;

  async executeForMedia(
    context: MediaStrategyContext
  ): Promise<ScoredMediaCandidate[]> {
    const { labelSpeech, filterParams } = context;

    if (!labelSpeech || labelSpeech.length === 0) {
      return [];
    }

    // Sort by start time
    const sortedSpeech = [...labelSpeech].sort((a, b) => a.start - b.start);

    // Cluster segments
    const clusters: LabelSpeech[][] = [];
    let currentCluster: LabelSpeech[] = [];

    // Gap threshold in seconds (e.g. 2 seconds silence breaks a cluster)
    const MAX_GAP = 2.0;

    for (const speech of sortedSpeech) {
      if (currentCluster.length === 0) {
        currentCluster.push(speech);
        continue;
      }

      const lastInCluster = currentCluster[currentCluster.length - 1];

      // Check for gap
      if (speech.start - lastInCluster.end > MAX_GAP) {
        clusters.push(currentCluster);
        currentCluster = [speech];
        continue;
      }

      currentCluster.push(speech);
    }
    if (currentCluster.length > 0) {
      clusters.push(currentCluster);
    }

    const candidates: ScoredMediaCandidate[] = [];

    for (const cluster of clusters) {
      const start = cluster[0].start;
      const end = cluster[cluster.length - 1].end;
      const duration = end - start;

      // Calculate average confidence
      const avgConfidence =
        cluster.reduce((sum, s) => sum + s.confidence, 0) / cluster.length;

      // Extract unique speakers
      const speakers = new Set(
        cluster.map((s) => s.speakerTag).filter((t) => t !== undefined)
      );

      // Construct reason
      const reason = `Dialog cluster with ${speakers.size} speaker(s) (${cluster.length} segments)`;

      // Basic scoring logic
      let score = avgConfidence;

      // Bonus for optimal clip length (5s - 30s)
      if (duration >= 5 && duration <= 30) {
        score *= 1.2;
      } else if (duration < 2) {
        score *= 0.5; // Penalize very short clips
      }

      // Apply filters
      if (
        !this.passesFilters(
          {
            start,
            end,
            confidence: avgConfidence,
            labelType: LabelType.SPEECH,
          },
          filterParams
        )
      ) {
        continue;
      }

      candidates.push({
        start,
        end,
        score: this.normalizeScore(score, 0, 1.2), // Normalize considering bonus
        reason,
        reasonData: {
          speakerCount: speakers.size,
          segmentCount: cluster.length,
          transcriptSample:
            cluster[0].transcript.substring(0, 50) +
            (cluster[0].transcript.length > 50 ? '...' : ''),
        },
        labelType: LabelType.SPEECH,
      });
    }

    return candidates;
  }

  async executeForTimeline(
    context: TimelineStrategyContext
  ): Promise<ScoredTimelineCandidate[]> {
    const { availableClips, labelSpeech } = context;
    const candidates: ScoredTimelineCandidate[] = [];

    // Map clips to their speech content
    for (const clip of availableClips) {
      // Find speech labels overlapping this clip
      const clipSpeech = labelSpeech.filter(
        (l) =>
          l.MediaRef === clip.MediaRef &&
          l.start < clip.end &&
          l.end > clip.start
      );

      if (clipSpeech.length === 0) continue;

      // Score this clip based on speech density
      const speechDuration = clipSpeech.reduce((sum, s) => {
        const overlapStart = Math.max(s.start, clip.start);
        const overlapEnd = Math.min(s.end, clip.end);
        return sum + Math.max(0, overlapEnd - overlapStart);
      }, 0);

      const duration = clip.end - clip.start;
      if (duration <= 0) continue;

      const coverage = speechDuration / duration;

      if (coverage > 0.3) {
        // Threshold: at least 30% speech
        candidates.push({
          clipId: clip.id,
          score: coverage,
          reason: `Contains ${(coverage * 100).toFixed(0)}% speech`,
          reasonData: { coverage, speechCount: clipSpeech.length },
        });
      }
    }

    return candidates;
  }
}
