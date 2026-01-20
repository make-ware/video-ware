import type {
  Workspace,
  Media,
  MediaClip,
  LabelFace,
  LabelPerson,
  LabelObject,
  LabelShot,
  LabelTrack,
  LabelSpeech,
  LabelEntity,
  Timeline,
  TimelineClip,
  LabelType,
  RecommendationStrategy,
} from '@project/shared';

/**
 * Filter parameters for media recommendations
 */
export interface FilterParams {
  labelTypes?: LabelType[];
  minConfidence?: number;
  durationRange?: { min: number; max: number };
}

/**
 * Search parameters for timeline recommendations
 */
export interface SearchParams {
  labelTypes?: LabelType[];
  minConfidence?: number;
  durationRange?: { min: number; max: number };
  timeWindow?: number;
}

/**
 * Context for media-level recommendation generation
 */
export interface MediaStrategyContext {
  workspace: Workspace;
  media: Media;
  labelFaces: LabelFace[];
  labelPeople: LabelPerson[];
  labelObjects: LabelObject[];
  labelShots: LabelShot[];
  labelTracks: LabelTrack[];
  labelSpeech: LabelSpeech[];
  labelEntities: LabelEntity[];
  existingClips: MediaClip[];
  filterParams: FilterParams;
}

/**
 * Context for timeline-level recommendation generation
 */
export interface TimelineStrategyContext {
  workspace: Workspace;
  timeline: Timeline;
  timelineClips: TimelineClip[];
  seedClip?: MediaClip;
  availableClips: MediaClip[];
  labelFaces: LabelFace[];
  labelPeople: LabelPerson[];
  labelObjects: LabelObject[];
  labelShots: LabelShot[];
  labelTracks: LabelTrack[];
  labelSpeech: LabelSpeech[];
  labelEntities: LabelEntity[];
  searchParams: SearchParams;
}

/**
 * Scored candidate for media recommendations
 */
export interface ScoredMediaCandidate {
  start: number;
  end: number;
  clipId?: string;
  score: number;
  reason: string;
  reasonData: Record<string, unknown>;
  labelType: LabelType;
  strategy?: RecommendationStrategy;
}

/**
 * Scored candidate for timeline recommendations
 */
export interface ScoredTimelineCandidate {
  clipId: string;
  score: number;
  reason: string;
  reasonData: Record<string, unknown>;
  strategy?: RecommendationStrategy;
}

/**
 * Base interface for recommendation strategies
 */
export interface IRecommendationStrategy {
  readonly name: RecommendationStrategy;

  executeForMedia(
    context: MediaStrategyContext
  ): Promise<ScoredMediaCandidate[]>;

  executeForTimeline(
    context: TimelineStrategyContext
  ): Promise<ScoredTimelineCandidate[]>;
}
