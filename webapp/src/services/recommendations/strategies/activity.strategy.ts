import {
  LabelType,
  RecommendationStrategy,
  type LabelEntity,
} from '@project/shared';
import { BaseRecommendationStrategy } from './base-strategy';
import type {
  MediaStrategyContext,
  ScoredMediaCandidate,
  ScoredTimelineCandidate,
  TimelineStrategyContext,
  FilterParams,
  SearchParams,
} from '../types';

type ActivityLabel = {
  key: string;
  start: number;
  end: number;
  confidence: number;
  labelType: LabelType;
  entityRef?: string;
};

type ActivitySegment = {
  start: number;
  end: number;
  active: ActivityLabel[];
};

type SegmentSummary = {
  score: number;
  averageConfidence: number;
  primaryLabelType: LabelType;
  reason: string;
  reasonData: Record<string, unknown>;
};

export class ActivityStrategy extends BaseRecommendationStrategy {
  readonly name = RecommendationStrategy.ACTIVITY_STRATEGY;

  async executeForMedia(
    context: MediaStrategyContext
  ): Promise<ScoredMediaCandidate[]> {
    const activityLabels = this.buildActivityLabels(
      context,
      context.filterParams
    );
    const segments = this.collectActivitySegments(activityLabels);
    const candidates: ScoredMediaCandidate[] = [];

    for (const segment of segments) {
      const summary = this.summarizeSegment(
        segment.active,
        context.labelEntities
      );
      if (!summary) continue;

      if (
        !this.passesFilters(
          {
            start: segment.start,
            end: segment.end,
            confidence: summary.averageConfidence,
            labelType: summary.primaryLabelType,
          },
          context.filterParams
        )
      ) {
        continue;
      }

      const matchingClip = context.existingClips.find(
        (mc) => mc.start <= segment.start && mc.end >= segment.end
      );

      candidates.push({
        start: segment.start,
        end: segment.end,
        clipId: matchingClip?.id,
        score: summary.score,
        reason: summary.reason,
        reasonData: summary.reasonData,
        labelType: summary.primaryLabelType,
      });
    }

    return candidates;
  }

  async executeForTimeline(
    context: TimelineStrategyContext
  ): Promise<ScoredTimelineCandidate[]> {
    const activityLabels = this.buildActivityLabels(
      context,
      context.searchParams
    );
    if (activityLabels.length === 0) return [];

    const candidates: ScoredTimelineCandidate[] = [];

    for (const clip of context.availableClips) {
      if (context.seedClip && clip.id === context.seedClip.id) continue;

      const clipLabels = activityLabels
        .filter((label) => label.start < clip.end && label.end > clip.start)
        .map((label) => ({
          ...label,
          start: Math.max(label.start, clip.start),
          end: Math.min(label.end, clip.end),
        }));

      const segments = this.collectActivitySegments(clipLabels);
      if (segments.length === 0) continue;

      const best = this.pickBestSegment(segments, context.labelEntities);
      if (!best) continue;

      candidates.push({
        clipId: clip.id,
        score: best.score,
        reason: best.reason,
        reasonData: best.reasonData,
      });
    }

    return candidates;
  }

  private buildActivityLabels(
    context: Pick<
      MediaStrategyContext,
      'labelFaces' | 'labelPeople' | 'labelObjects' | 'labelSpeech'
    >,
    filters: FilterParams | SearchParams
  ): ActivityLabel[] {
    const minConfidence = filters.minConfidence ?? 0;

    const candidates: ActivityLabel[] = [
      ...context.labelFaces.map((face) => ({
        key: `face:${face.id ?? face.LabelEntityRef ?? `${face.start}-${face.end}`}`,
        start: face.start,
        end: face.end,
        confidence: face.avgConfidence,
        labelType: LabelType.FACE,
        entityRef: face.LabelEntityRef,
      })),
      ...context.labelPeople.map((person) => ({
        key: `person:${person.id ?? person.LabelEntityRef ?? `${person.start}-${person.end}`}`,
        start: person.start,
        end: person.end,
        confidence: person.confidence,
        labelType: LabelType.PERSON,
        entityRef: person.LabelEntityRef,
      })),
      ...context.labelObjects.map((object) => ({
        key: `object:${object.id ?? object.LabelEntityRef ?? `${object.start}-${object.end}`}`,
        start: object.start,
        end: object.end,
        confidence: object.confidence,
        labelType: LabelType.OBJECT,
        entityRef: object.LabelEntityRef,
      })),
      ...context.labelSpeech.map((speech) => ({
        key: `speech:${speech.id ?? `${speech.start}-${speech.end}`}`,
        start: speech.start,
        end: speech.end,
        confidence: speech.confidence,
        labelType: LabelType.SPEECH,
        entityRef: speech.LabelEntityRef,
      })),
    ];

    return candidates.filter((label) => {
      if (label.confidence < minConfidence) return false;
      if (filters.labelTypes && filters.labelTypes.length > 0) {
        return filters.labelTypes.includes(label.labelType);
      }
      return true;
    });
  }

  private collectActivitySegments(labels: ActivityLabel[]): ActivitySegment[] {
    if (labels.length < 2) return [];

    const events = labels.flatMap((label) => [
      { time: label.start, type: 'start' as const, label },
      { time: label.end, type: 'end' as const, label },
    ]);

    events.sort((a, b) => {
      if (a.time !== b.time) return a.time - b.time;
      return a.type === 'start' ? -1 : 1;
    });

    const active = new Map<string, ActivityLabel>();
    const segments: ActivitySegment[] = [];
    let lastTime: number | null = null;

    for (const event of events) {
      if (lastTime !== null && event.time > lastTime && active.size >= 2) {
        segments.push({
          start: lastTime,
          end: event.time,
          active: Array.from(active.values()),
        });
      }

      if (event.type === 'start') {
        active.set(event.label.key, event.label);
      } else {
        active.delete(event.label.key);
      }
      lastTime = event.time;
    }

    return segments;
  }

  private pickBestSegment(
    segments: ActivitySegment[],
    labelEntities: LabelEntity[]
  ): SegmentSummary | null {
    let best: SegmentSummary | null = null;

    for (const segment of segments) {
      const summary = this.summarizeSegment(segment.active, labelEntities);
      if (!summary) continue;
      if (!best || summary.score > best.score) {
        best = summary;
      }
    }

    return best;
  }

  private summarizeSegment(
    activeLabels: ActivityLabel[],
    labelEntities: LabelEntity[]
  ): SegmentSummary | null {
    if (activeLabels.length < 2) return null;

    const activeCount = activeLabels.length;
    const averageConfidence =
      activeLabels.reduce((sum, label) => sum + label.confidence, 0) /
      activeLabels.length;
    const countScore = Math.min(1, (activeCount - 1) / 4);
    const score = Math.min(1, 0.5 * averageConfidence + 0.5 * countScore);
    const primaryLabelType = activeLabels.reduce((best, label) =>
      label.confidence > best.confidence ? label : best
    ).labelType;
    const activeLabelTypes = Array.from(
      new Set(activeLabels.map((label) => label.labelType))
    );
    const activeEntities = Array.from(
      new Set(
        activeLabels
          .map((label) =>
            label.entityRef
              ? labelEntities.find((entity) => entity.id === label.entityRef)
                  ?.canonicalName
              : undefined
          )
          .filter((name): name is string => !!name)
      )
    );

    const reason =
      activeLabelTypes.length > 0
        ? `Activity overlap (${activeCount}): ${activeLabelTypes.join(', ')}`
        : `Activity overlap (${activeCount})`;

    return {
      score,
      averageConfidence,
      primaryLabelType,
      reason,
      reasonData: {
        activeCount,
        activeLabelTypes,
        activeEntities,
        averageConfidence,
      },
    };
  }
}
