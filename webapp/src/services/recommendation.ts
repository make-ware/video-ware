import type { TypedPocketBase } from '@project/shared/types';
import {
  MediaMutator,
  TimelineMutator,
  TimelineClipMutator,
  MediaClipMutator,
  LabelFaceMutator,
  LabelPersonMutator,
  LabelObjectMutator,
  LabelTrackMutator,
  LabelSpeechMutator,
  LabelEntityMutator,
  MediaRecommendationMutator,
  TimelineRecommendationMutator,
} from '@project/shared/mutator';
import {
  RecommendationStrategy,
  RecommendationTargetMode,
  type MediaClip,
  type LabelEntity,
  type Workspace,
  type MediaRecommendation,
  type TimelineRecommendation,
  buildMediaQueryHash,
  buildTimelineQueryHash,
} from '@project/shared';

import { StrategyRegistry, ScoreCombiner } from './recommendations/strategies';
import type {
  FilterParams,
  SearchParams,
  MediaStrategyContext,
  TimelineStrategyContext,
  ScoredMediaCandidate,
  ScoredTimelineCandidate,
} from './recommendations/types';

/**
 * Recommendation service that provides on-demand recommendations
 * using a pluggable strategy pattern.
 */
export class RecommendationService {
  private static readonly MIN_RECOMMENDATION_DURATION_SECONDS = 5;
  private static readonly MAX_REASON_LENGTH = 500;

  private labelFaceMutator: LabelFaceMutator;
  private labelPersonMutator: LabelPersonMutator;
  private labelObjectMutator: LabelObjectMutator;
  private labelTrackMutator: LabelTrackMutator;
  private labelSpeechMutator: LabelSpeechMutator;
  private labelEntityMutator: LabelEntityMutator;
  private mediaRecommendationMutator: MediaRecommendationMutator;
  private timelineRecommendationMutator: TimelineRecommendationMutator;

  private registry: StrategyRegistry;
  private combiner: ScoreCombiner;

  private _pb: TypedPocketBase;

  constructor(pb: TypedPocketBase) {
    this._pb = pb;
    this.labelFaceMutator = new LabelFaceMutator(pb);
    this.labelPersonMutator = new LabelPersonMutator(pb);
    this.labelObjectMutator = new LabelObjectMutator(pb);
    this.labelTrackMutator = new LabelTrackMutator(pb);
    this.labelSpeechMutator = new LabelSpeechMutator(pb);
    this.labelEntityMutator = new LabelEntityMutator(pb);
    this.mediaRecommendationMutator = new MediaRecommendationMutator(pb);
    this.timelineRecommendationMutator = new TimelineRecommendationMutator(pb);

    this.registry = new StrategyRegistry();
    this.combiner = new ScoreCombiner();
  }

  private get pb(): TypedPocketBase {
    return this._pb;
  }

  private static sanitizeReason(reason: string): string {
    const trimmed = (reason ?? '').trim();
    if (trimmed.length === 0) return 'Recommendation';
    if (trimmed.length <= RecommendationService.MAX_REASON_LENGTH)
      return trimmed;
    // Keep within schema limit (500). Reserve space for ellipsis.
    return `${trimmed.slice(0, RecommendationService.MAX_REASON_LENGTH - 1)}…`;
  }

  /**
   * Get media-level recommendations (segments)
   */
  async getMediaRecommendations(
    workspaceId: string,
    mediaId: string,
    filterParams: FilterParams = {},
    maxResults: number = 10,
    forceRefresh: boolean = false,
    requestedStrategies?: RecommendationStrategy[]
  ): Promise<MediaRecommendation[]> {
    const context = await this.loadMediaContext(
      workspaceId,
      mediaId,
      filterParams
    );

    const minDurationSeconds = Math.max(
      RecommendationService.MIN_RECOMMENDATION_DURATION_SECONDS,
      filterParams.durationRange?.min ?? 0
    );

    let strategies = this.registry.getAll();
    if (requestedStrategies && requestedStrategies.length > 0) {
      strategies = strategies.filter((s) =>
        requestedStrategies.includes(s.name)
      );
    }

    const queryHash = buildMediaQueryHash({
      workspaceId,
      mediaId,
      mediaVersion: context.media.version || 1,
      strategies: strategies.map((s) => s.name),
      filterParams,
    });

    // Check cache unless forceRefresh is true
    if (!forceRefresh) {
      const cached = await this.mediaRecommendationMutator.getTopByQueryHash(
        queryHash,
        maxResults
      );
      const cachedFiltered = cached
        .filter((r) => r.end - r.start >= minDurationSeconds)
        .slice(0, maxResults);
      if (cachedFiltered.length > 0) {
        return cachedFiltered;
      }
    }

    const candidatesByStrategy = new Map<
      RecommendationStrategy,
      ScoredMediaCandidate[]
    >();

    for (const strategy of strategies) {
      const candidates = await strategy.executeForMedia(context);
      candidatesByStrategy.set(strategy.name, candidates);
    }

    const combined = this.combiner.combineMediaCandidates(candidatesByStrategy);

    // Final filtering and sorting
    let filtered = combined;
    filtered = filtered.filter((c) => c.end - c.start >= minDurationSeconds);
    if (filterParams.durationRange?.max) {
      filtered = filtered.filter(
        (c) => c.end - c.start <= filterParams.durationRange!.max!
      );
    }

    const ranked = filtered
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    // Persist recommendations
    const persisted = await Promise.all(
      ranked.map((c, index) =>
        this.mediaRecommendationMutator.upsert({
          WorkspaceRef: workspaceId,
          MediaRef: mediaId,
          start: c.start,
          end: c.end,
          score: c.score,
          rank: index,
          reason: RecommendationService.sanitizeReason(c.reason),
          reasonData: c.reasonData,
          strategy: c.strategy ?? RecommendationStrategy.SAME_ENTITY,
          labelType: c.labelType,
          queryHash,
          version: 1,
        })
      )
    );

    return persisted;
  }

  /**
   * Get timeline-level recommendations
   */
  async getTimelineRecommendations(
    workspaceId: string,
    timelineId: string,
    seedClipId?: string,
    searchParams: SearchParams = {},
    maxResults: number = 10,
    forceRefresh: boolean = false,
    requestedStrategies?: RecommendationStrategy[]
  ): Promise<TimelineRecommendation[]> {
    const context = await this.loadTimelineContext(
      workspaceId,
      timelineId,
      seedClipId,
      searchParams
    );

    const minDurationSeconds = Math.max(
      RecommendationService.MIN_RECOMMENDATION_DURATION_SECONDS,
      searchParams.durationRange?.min ?? 0
    );

    let strategies = this.registry.getAll();
    if (requestedStrategies && requestedStrategies.length > 0) {
      strategies = strategies.filter((s) =>
        requestedStrategies.includes(s.name)
      );
    }

    // Calculate query hash for caching
    const queryHash = buildTimelineQueryHash({
      workspaceId,
      timelineId,
      mediaVersion: 1, // Default for now
      seedClipId,
      targetMode: RecommendationTargetMode.APPEND, // Default for now
      strategies: strategies.map((s) => s.name),
      searchParams,
    });

    // Check cache
    if (!forceRefresh) {
      const cached = await this.timelineRecommendationMutator.getTopByQueryHash(
        queryHash,
        maxResults
      );
      const cachedFiltered = cached
        .filter((r) => {
          const clip = context.availableClips.find(
            (c) => c.id === r.MediaClipRef
          );
          if (!clip) return false;
          return clip.end - clip.start >= minDurationSeconds;
        })
        .slice(0, maxResults);
      if (cachedFiltered.length > 0) {
        return cachedFiltered;
      }
    }

    const candidatesByStrategy = new Map<
      RecommendationStrategy,
      ScoredTimelineCandidate[]
    >();

    for (const strategy of strategies) {
      const candidates = await strategy.executeForTimeline(context);
      candidatesByStrategy.set(strategy.name, candidates);
    }

    const combined =
      this.combiner.combineTimelineCandidates(candidatesByStrategy);

    // Filter out candidates that are shorter than the minimum duration
    const combinedMinDuration = combined.filter((c) => {
      const clip = context.availableClips.find((ac) => ac.id === c.clipId);
      if (!clip) return false;
      return clip.end - clip.start >= minDurationSeconds;
    });

    // Filter out duplicates (clips already in timeline)
    // AND clips that overlap with existing timeline content from the same media
    const timelineClips = context.timelineClips;

    const uniqueCandidates = combinedMinDuration.filter((c) => {
      // 1. Exact clip ID check
      if (timelineClips.some((tc) => tc.MediaClipRef === c.clipId))
        return false;

      // 2. Source Media overlap check
      const candidateClip = context.availableClips.find(
        (ac) => ac.id === c.clipId
      );
      if (!candidateClip) return false;

      for (const tc of timelineClips) {
        // Look up timeline clip's media clip
        const tcMediaClip = context.availableClips.find(
          (ac) => ac.id === tc.MediaClipRef
        );
        if (!tcMediaClip) continue;

        if (tcMediaClip.MediaRef === candidateClip.MediaRef) {
          // Same source media. Check for overlap.
          const tcStart = tcMediaClip.start;
          const tcEnd = tcMediaClip.end;

          const cStart = candidateClip.start;
          const cEnd = candidateClip.end;

          if (Math.max(tcStart, cStart) < Math.min(tcEnd, cEnd)) {
            // Overlap found
            return false;
          }
        }
      }
      return true;
    });

    const ranked = uniqueCandidates
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    // Persist recommendations
    const persisted = await Promise.all(
      ranked.map((c, index) =>
        this.timelineRecommendationMutator.upsert({
          WorkspaceRef: workspaceId,
          TimelineRef: timelineId,
          SeedClipRef: seedClipId,
          MediaClipRef: c.clipId,
          score: c.score,
          rank: index,
          reason: RecommendationService.sanitizeReason(c.reason),
          reasonData: c.reasonData,
          strategy: c.strategy ?? RecommendationStrategy.SAME_ENTITY,
          targetMode: RecommendationTargetMode.APPEND,
          queryHash,
          version: 1,
        })
      )
    );

    return persisted;
  }

  /**
   * Get replacement recommendations for a specific timeline clip
   */
  async getTimelineClipReplacementRecommendations(
    workspaceId: string,
    timelineId: string,
    timelineClipId: string
  ): Promise<TimelineRecommendation[]> {
    const timelineClipMutator = new TimelineClipMutator(this.pb);
    const timelineClip = await timelineClipMutator.getById(timelineClipId);
    if (!timelineClip || !timelineClip.MediaClipRef) {
      throw new Error(
        `Timeline clip ${timelineClipId} not found or has no media clip reference`
      );
    }

    return this.getTimelineRecommendations(
      workspaceId,
      timelineId,
      timelineClip.MediaClipRef,
      {}
    );
  }

  private async loadMediaContext(
    workspaceId: string,
    mediaId: string,
    filterParams: FilterParams
  ): Promise<MediaStrategyContext> {
    const workspace = { id: workspaceId, name: 'Workspace' } as Workspace;
    const mediaMutator = new MediaMutator(this.pb);
    const media = await mediaMutator.getById(mediaId);
    if (!media) throw new Error(`Media ${mediaId} not found`);

    const labelFaces = (await this.labelFaceMutator.getByMedia(mediaId)).items;
    const labelPeople = (await this.labelPersonMutator.getByMedia(mediaId))
      .items;
    const labelObjects = (await this.labelObjectMutator.getByMedia(mediaId))
      .items;
    const labelTracks = (await this.labelTrackMutator.getByMedia(mediaId))
      .items;
    const labelSpeech = (await this.labelSpeechMutator.getByMedia(mediaId))
      .items;

    const entityIds = new Set([
      ...labelFaces.map((f) => f.LabelEntityRef),
      ...labelPeople.map((p) => p.LabelEntityRef),
      ...labelObjects.map((o) => o.LabelEntityRef),
      ...labelSpeech
        .map((s) => s.LabelEntityRef)
        .filter((id): id is string => !!id),
    ]);

    const labelEntities = await Promise.all(
      Array.from(entityIds).map((id) => this.labelEntityMutator.getById(id))
    ).then((entities) => entities.filter((e): e is LabelEntity => !!e));

    const mediaClipMutator = new MediaClipMutator(this.pb);
    const existingClipsResult = await mediaClipMutator.getByMedia(mediaId);
    const existingClips = existingClipsResult.items;

    return {
      workspace,
      media,
      labelFaces,
      labelPeople,
      labelObjects,
      labelShots: [],
      labelTracks,
      labelSpeech,
      labelEntities,
      existingClips,
      filterParams,
    };
  }

  private async loadTimelineContext(
    workspaceId: string,
    timelineId: string,
    seedClipId: string | undefined,
    searchParams: SearchParams
  ): Promise<TimelineStrategyContext> {
    const workspace = { id: workspaceId, name: 'Workspace' } as Workspace;
    const timelineMutator = new TimelineMutator(this.pb);
    const timeline = await timelineMutator.getById(timelineId);
    if (!timeline) throw new Error(`Timeline ${timelineId} not found`);

    const timelineClipMutator = new TimelineClipMutator(this.pb);
    const timelineClips = await timelineClipMutator.getByTimeline(timelineId);

    const mediaClipMutator = new MediaClipMutator(this.pb);
    let seedClip: MediaClip | undefined;
    if (seedClipId) {
      // seedClipId refers to a TimelineClip, so we need to find it first
      const seedTimelineClip = timelineClips.find((c) => c.id === seedClipId);
      if (seedTimelineClip?.MediaClipRef) {
        seedClip =
          (await mediaClipMutator.getById(seedTimelineClip.MediaClipRef)) ??
          undefined;
      }
    }

    const availableClipsResult =
      await mediaClipMutator.getByWorkspace(workspaceId);
    const availableClips = availableClipsResult.items;

    const mediaIds = Array.from(
      new Set(availableClips.map((clip) => clip.MediaRef))
    );

    // Fetch from all specialized collections
    const [faces, people, objects, tracks, speech] = await Promise.all([
      Promise.all(mediaIds.map((id) => this.labelFaceMutator.getByMedia(id))),
      Promise.all(mediaIds.map((id) => this.labelPersonMutator.getByMedia(id))),
      Promise.all(mediaIds.map((id) => this.labelObjectMutator.getByMedia(id))),
      Promise.all(mediaIds.map((id) => this.labelTrackMutator.getByMedia(id))),
      Promise.all(mediaIds.map((id) => this.labelSpeechMutator.getByMedia(id))),
    ]);

    const labelFaces = faces.flatMap((r) => r.items);
    const labelPeople = people.flatMap((r) => r.items);
    const labelObjects = objects.flatMap((r) => r.items);
    const labelTracks = tracks.flatMap((r) => r.items);
    const labelSpeech = speech.flatMap((r) => r.items);

    const entityIds = new Set([
      ...labelFaces.map((f) => f.LabelEntityRef),
      ...labelPeople.map((p) => p.LabelEntityRef),
      ...labelObjects.map((o) => o.LabelEntityRef),
      ...labelSpeech
        .map((s) => s.LabelEntityRef)
        .filter((id): id is string => !!id),
    ]);

    const labelEntities = await Promise.all(
      Array.from(entityIds).map((id) => this.labelEntityMutator.getById(id))
    ).then((entities) => entities.filter((e): e is LabelEntity => !!e));

    return {
      workspace,
      timeline,
      timelineClips,
      seedClip,
      availableClips,
      labelFaces,
      labelPeople,
      labelObjects,
      labelShots: [],
      labelTracks,
      labelSpeech,
      labelEntities,
      searchParams,
    };
  }
}

export function createRecommendationService(
  pb: TypedPocketBase
): RecommendationService {
  return new RecommendationService(pb);
}
