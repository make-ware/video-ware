import { RecommendationStrategy, LabelType } from '@project/shared';
import { BaseRecommendationStrategy } from './base-strategy';
import type {
  MediaStrategyContext,
  ScoredMediaCandidate,
  ScoredTimelineCandidate,
  TimelineStrategyContext,
} from '../types';

/**
 * Same Entity Strategy
 *
 * Recommends segments/clips that share the same LabelEntity with the seed clip.
 */
export class SameEntityStrategy extends BaseRecommendationStrategy {
  readonly name = RecommendationStrategy.SAME_ENTITY;

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

    const detectionsByEntity = new Map<
      string,
      (typeof allDetections)[number][]
    >();

    for (const det of allDetections) {
      if (!det.LabelEntityRef) continue;
      if (!detectionsByEntity.has(det.LabelEntityRef)) {
        detectionsByEntity.set(det.LabelEntityRef, []);
      }
      detectionsByEntity.get(det.LabelEntityRef)!.push(det);
    }

    for (const [entityId, detections] of detectionsByEntity.entries()) {
      const entity = context.labelEntities.find((e) => e.id === entityId);
      if (!entity) continue;

      for (const det of detections) {
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
          // Generic reason to avoid flakey label names
          reason: `Same entity found`,
          reasonData: {
            entityId: entity.id,
            // entityName: entity.canonicalName, // Omit or keep for debugging but not show to user?
            // The frontend might use reasonData, but usually displays 'reason' field.
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

    const seedDetections = allDetections.filter(
      (d) =>
        d.MediaRef === context.seedClip!.MediaRef &&
        d.start >= context.seedClip!.start &&
        d.end <= context.seedClip!.end
    );

    const seedEntityIds = new Set(
      seedDetections
        .map((d) => d.LabelEntityRef)
        .filter((id): id is string => !!id)
    );
    if (seedEntityIds.size === 0) return [];

    for (const clip of context.availableClips) {
      if (clip.id === context.seedClip.id) continue;

      const candidateDetections = allDetections.filter(
        (d) =>
          d.MediaRef === clip.MediaRef &&
          d.start >= clip.start &&
          d.end <= clip.end
      );

      // Find shared entities
      const sharedCount = candidateDetections
        .filter((d) => d.LabelEntityRef && seedEntityIds.has(d.LabelEntityRef))
        .map((d) => d.LabelEntityRef)
        .filter((id, index, self) => self.indexOf(id) === index).length; // Unique count

      if (sharedCount > 0) {
        candidates.push({
          clipId: clip.id,
          score: 0.5 + Math.min(0.5, sharedCount * 0.1),
          // Generic reason
          reason: `Shares ${sharedCount} common entit${sharedCount === 1 ? 'y' : 'ies'}`,
          reasonData: { sharedCount },
        });
      }
    }
    return candidates;
  }
}
