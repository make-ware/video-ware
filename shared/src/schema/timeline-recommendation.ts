import {
  defineCollection,
  RelationField,
  RelationsField,
  NumberField,
  JSONField,
  TextField,
  DateField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';
import { RecommendationStrategy, RecommendationTargetMode } from '../enums';

// Re-export the enum for convenience
export { RecommendationTargetMode } from '../enums';

/**
 * TimelineRecommendation Schema
 *
 * Stores timeline-level recommendations for contextual editing suggestions.
 * Each recommendation points to a MediaClip that could be added to or replace
 * content in a timeline, with context awareness and feedback tracking.
 */
export const TimelineRecommendationSchema = z
  .object({
    // Scoping
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    TimelineRef: RelationField({ collection: 'Timelines' }),
    MediaClipRef: RelationField({ collection: 'MediaClips' }), // The suggested clip

    // Context
    // Timeline clips created from this recommendation
    TimelineClipsRef: RelationsField({
      collection: 'TimelineClips',
    }).optional(),
    SeedClipRef: RelationField({ collection: 'TimelineClips' }).optional(), // Context clip for recommendations

    // Scoring
    score: NumberField({ min: 0, max: 1 }), // 0-1 relevance score
    rank: NumberField({ min: 0 }), // Pre-computed ordering (0-based)

    // Explanation
    reason: TextField({ min: 1, max: 500 }), // Human-readable explanation
    reasonData: JSONField(), // Structured explanation data

    // Strategy and target mode
    strategy: TextField(),
    targetMode: TextField(),

    // Deduplication
    queryHash: TextField({ min: 1 }), // Deterministic hash for upsert behavior

    // Feedback timestamps
    acceptedAt: DateField().optional(), // When user accepted the recommendation
    dismissedAt: DateField().optional(), // When user dismissed the recommendation

    // Versioning
    version: NumberField().default(1),
    processor: TextField().optional(), // e.g., "recommendation-engine:1.0.0"
  })
  .extend(baseSchema);

/**
 * Input schema for creating timeline recommendations
 */
export const TimelineRecommendationInputSchema = z.object({
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  TimelineRef: z.string().min(1, 'Timeline is required'),
  SeedClipRef: z.string().optional(),
  TimelineClipsRef: z.array(z.string()).optional(),
  MediaClipRef: z.string().min(1, 'Media clip is required'),
  score: z.number().min(0).max(1, 'Score must be between 0 and 1'),
  rank: z.number().int().min(0, 'Rank must be a non-negative integer'),
  reason: z.string().min(1).max(500, 'Reason must be 1-500 characters'),
  reasonData: JSONField(),
  strategy: z.enum([
    RecommendationStrategy.SAME_ENTITY,
    RecommendationStrategy.TEMPORAL_CONTINUITY,
    RecommendationStrategy.TEMPORAL_NEARBY,
    RecommendationStrategy.CONFIDENCE_DURATION,
    RecommendationStrategy.DIALOG_CLUSTER,
    RecommendationStrategy.OBJECT_POSITION_MATCHER,
    RecommendationStrategy.ACTIVITY_STRATEGY,
  ]),
  targetMode: z.enum([
    RecommendationTargetMode.APPEND,
    RecommendationTargetMode.REPLACE,
  ]),
  queryHash: z.string().min(1, 'Query hash is required'),
  acceptedAt: z.string().datetime().optional(),
  dismissedAt: z.string().datetime().optional(),
  version: z.number().default(1),
  processor: z.string().optional(),
});

/**
 * TimelineRecommendations Collection Definition
 *
 * Indexes:
 * - Unique index on (queryHash, MediaClipRef) for upsert behavior
 * - Index on (WorkspaceRef, TimelineRef, queryHash) for context lookups
 * - Index on (queryHash, rank) for ordered retrieval
 * - Index on (strategy, acceptedAt, dismissedAt) for analytics
 */
export const TimelineRecommendationCollection = defineCollection({
  collectionName: 'TimelineRecommendations',
  schema: TimelineRecommendationSchema,
  permissions: {
    // Authenticated users can list timeline recommendations
    listRule: '@request.auth.id != ""',
    // Authenticated users can view timeline recommendations
    viewRule: '@request.auth.id != ""',
    // Authenticated users can create timeline recommendations
    createRule: '@request.auth.id != ""',
    // Authenticated users can update timeline recommendations
    updateRule: '@request.auth.id != ""',
    // Authenticated users can delete timeline recommendations
    deleteRule: '@request.auth.id != ""',
  },
  indexes: [
    // Unique index for upsert behavior (queryHash + recommended clip)
    'CREATE UNIQUE INDEX idx_timeline_rec_hash_clip ON TimelineRecommendations (queryHash, MediaClipRef)',
    // Index for context lookups
    'CREATE INDEX idx_timeline_rec_context ON TimelineRecommendations (WorkspaceRef, TimelineRef, queryHash)',
    // Index for ordered retrieval
    'CREATE INDEX idx_timeline_rec_rank ON TimelineRecommendations (queryHash, rank)',
    // Index for analytics (feedback tracking by strategy)
    'CREATE INDEX idx_timeline_rec_feedback ON TimelineRecommendations (strategy, acceptedAt, dismissedAt)',
  ],
});

export default TimelineRecommendationCollection;

// Export TypeScript types
export type TimelineRecommendation = z.infer<
  typeof TimelineRecommendationSchema
>;
export type TimelineRecommendationInput = z.infer<
  typeof TimelineRecommendationInputSchema
>;
export type TimelineRecommendationUpdate = Partial<TimelineRecommendationInput>;

/**
 * ReasonData structure for TimelineRecommendations
 * This provides type safety for the reasonData JSON field
 */
export interface TimelineReasonData {
  // For same_entity strategy
  entityId?: string;
  entityName?: string;
  matchedLabels?: string[];
  seedClipEntityMatch?: boolean;

  // For adjacent_shot strategy
  shotIndex?: number;
  direction?: 'previous' | 'next';

  // For temporal_nearby strategy
  timeDelta?: number;

  // For confidence_duration strategy
  confidence?: number;
  durationDelta?: number;

  // For activity_strategy
  activeCount?: number;
  activeLabelTypes?: string[];
  averageConfidence?: number;

  // For score combiner (when multiple strategies contribute)
  combinedStrategies?: RecommendationStrategy[];
  individualScores?: Record<string, number>;

  // Common
  sourceClipId?: string;
  labelClipIds?: string[];
}
