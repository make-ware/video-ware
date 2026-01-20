import { RecordService } from 'pocketbase';
import type { ListResult, RecordOptions } from 'pocketbase';
import { TimelineRecommendationInputSchema } from '../schema';
import type {
  TimelineRecommendation,
  TimelineRecommendationInput,
  TimelineClip,
  MediaClip,
} from '../schema';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';
import { RecommendationStrategy, RecommendationTargetMode } from '../enums';

/**
 * Options for searching timeline recommendations
 */
export interface TimelineRecommendationSearchOptions {
  /** Filter by recommendation strategy */
  strategy?: RecommendationStrategy;
  /** Filter by target mode */
  targetMode?: RecommendationTargetMode;
  /** Minimum score threshold (0-1) */
  minScore?: number;
  /** Maximum score threshold (0-1) */
  maxScore?: number;
  /** Filter by timeline reference */
  timelineRef?: string;
  /** Filter by workspace reference */
  workspaceRef?: string;
  /** Filter by query hash */
  queryHash?: string;
  /** Filter by seed clip reference */
  seedClipRef?: string;
  /** Filter by media clip reference */
  mediaClipRef?: string;
  /** Filter by accepted status (true = accepted, false = not accepted) */
  accepted?: boolean;
  /** Filter by dismissed status (true = dismissed, false = not dismissed) */
  dismissed?: boolean;
}

export class TimelineRecommendationMutator extends BaseMutator<
  TimelineRecommendation,
  TimelineRecommendationInput
> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<TimelineRecommendation> {
    return this.pb.collection('TimelineRecommendations');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: [
        'WorkspaceRef',
        'TimelineRef',
        'TimelineClipsRef',
        'SeedClipRef',
        'MediaClipRef',
        'MediaClipRef.MediaRef', // Get Media directly - much simpler!
        'MediaClipRef.MediaRef.spriteFileRef',
        'MediaClipRef.MediaRef.thumbnailFileRef',
      ],
      filter: [],
      sort: ['rank', 'score'], // Sort by rank first, then score
    };
  }

  protected async validateInput(
    input: TimelineRecommendationInput
  ): Promise<TimelineRecommendationInput> {
    // Map MediaClipRef to MediaClipRef for the database schema
    const validated = TimelineRecommendationInputSchema.parse(input);
    // The input schema uses MediaClipRef, but we need to map it
    // to MediaClipRef for the actual database record
    return {
      ...validated,
      // Note: The input schema has MediaClipRef, but the database
      // schema expects MediaClipRef. This mapping will be handled by the
      // entityCreate method or we need to transform it here.
      // For now, we'll pass it through and let the schema handle it
    } as TimelineRecommendationInput;
  }

  /**
   * Transform input to match database schema
   * Maps MediaClipRef from input to MediaClipRef for database
   */
  private transformInputForCreate(
    input: TimelineRecommendationInput
  ): Record<string, unknown> {
    const { MediaClipRef, ...rest } = input;
    return {
      ...rest,
      MediaClipRef: MediaClipRef, // Map to database field name
    };
  }

  /**
   * Override entityCreate to handle field name mapping
   */
  protected async entityCreate(
    data: TimelineRecommendationInput
  ): Promise<TimelineRecommendation> {
    const transformed = this.transformInputForCreate(data);
    const finalExpand = this.prepareExpand();
    const options: RecordOptions = finalExpand ? { expand: finalExpand } : {};
    return await this.getCollection().create(
      transformed as Record<string, unknown>,
      options
    );
  }

  /**
   * Build filter string from search options
   * @param options Search options
   * @returns Filter string for PocketBase query
   */
  private buildSearchFilter(
    options: TimelineRecommendationSearchOptions
  ): string[] {
    const filters: string[] = [];

    // Filter by strategy
    if (options.strategy) {
      filters.push(`strategy = "${options.strategy}"`);
    }

    // Filter by target mode
    if (options.targetMode) {
      filters.push(`targetMode = "${options.targetMode}"`);
    }

    // Filter by score range
    if (options.minScore !== undefined) {
      filters.push(`score >= ${options.minScore}`);
    }
    if (options.maxScore !== undefined) {
      filters.push(`score <= ${options.maxScore}`);
    }

    // Filter by timeline reference
    if (options.timelineRef) {
      filters.push(`TimelineRef = "${options.timelineRef}"`);
    }

    // Filter by workspace reference
    if (options.workspaceRef) {
      filters.push(`WorkspaceRef = "${options.workspaceRef}"`);
    }

    // Filter by query hash
    if (options.queryHash) {
      filters.push(`queryHash = "${options.queryHash}"`);
    }

    // Filter by seed clip reference
    if (options.seedClipRef) {
      filters.push(`SeedClipRef = "${options.seedClipRef}"`);
    }

    // Filter by media clip reference
    if (options.mediaClipRef) {
      filters.push(`MediaClipRef = "${options.mediaClipRef}"`);
    }

    // Filter by accepted status
    if (options.accepted === true) {
      filters.push('acceptedAt != ""');
    } else if (options.accepted === false) {
      filters.push('acceptedAt = ""');
    }

    // Filter by dismissed status
    if (options.dismissed === true) {
      filters.push('dismissedAt != ""');
    } else if (options.dismissed === false) {
      filters.push('dismissedAt = ""');
    }

    return filters;
  }

  /**
   * Search timeline recommendations with filtering and pagination
   * @param options Search options
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @returns List of timeline recommendations matching the search criteria
   */
  async search(
    options: TimelineRecommendationSearchOptions,
    page = 1,
    perPage = 50
  ): Promise<ListResult<TimelineRecommendation>> {
    const filters = this.buildSearchFilter(options);
    return this.getList(
      page,
      perPage,
      filters,
      'rank,score', // Sort by rank first, then score
      [
        'WorkspaceRef',
        'TimelineRef',
        'TimelineClipsRef',
        'SeedClipRef',
        'MediaClipRef',
        'MediaClipRef.MediaRef',
        'MediaClipRef.MediaRef.spriteFileRef',
        'MediaClipRef.MediaRef.thumbnailFileRef',
      ]
    );
  }

  /**
   * Get timeline recommendations by timeline
   * Retrieves all recommendations for a specific timeline, sorted by rank and score
   * @param timelineId The timeline ID
   * @param options Optional filtering options
   * @param options.excludeAccepted Exclude accepted recommendations (default: false)
   * @param options.excludeDismissed Exclude dismissed recommendations (default: false)
   * @param options.strategy Filter by recommendation strategy
   * @param options.targetMode Filter by target mode
   * @param options.minScore Minimum score threshold
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   * @returns List of timeline recommendations for the timeline
   */
  async getByTimeline(
    timelineId: string,
    options?: {
      excludeAccepted?: boolean;
      excludeDismissed?: boolean;
      strategy?: RecommendationStrategy;
      targetMode?: RecommendationTargetMode;
      minScore?: number;
    },
    page = 1,
    perPage = 100
  ): Promise<ListResult<TimelineRecommendation>> {
    const filters: string[] = [`TimelineRef = "${timelineId}"`];

    if (options) {
      if (options.excludeAccepted) {
        filters.push('acceptedAt = ""');
      }
      if (options.excludeDismissed) {
        filters.push('dismissedAt = ""');
      }
      if (options.strategy) {
        filters.push(`strategy = "${options.strategy}"`);
      }
      if (options.targetMode) {
        filters.push(`targetMode = "${options.targetMode}"`);
      }
      if (options.minScore !== undefined) {
        filters.push(`score >= ${options.minScore}`);
      }
    }

    return this.getList(
      page,
      perPage,
      filters,
      'rank,score', // Sort by rank first, then score
      [
        'WorkspaceRef',
        'TimelineRef',
        'TimelineClipsRef',
        'SeedClipRef',
        'MediaClipRef',
        'MediaClipRef.MediaRef',
        'MediaClipRef.MediaRef.spriteFileRef',
        'MediaClipRef.MediaRef.thumbnailFileRef',
      ]
    );
  }

  /**
   * Get timeline recommendations by workspace
   * @param workspaceId The workspace ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @returns List of timeline recommendations for the workspace
   */
  async getByWorkspace(
    workspaceId: string,
    page = 1,
    perPage = 50
  ): Promise<ListResult<TimelineRecommendation>> {
    return this.getList(
      page,
      perPage,
      `WorkspaceRef = "${workspaceId}"`,
      'rank,score', // Sort by rank first, then score
      [
        'WorkspaceRef',
        'TimelineRef',
        'TimelineClipsRef',
        'SeedClipRef',
        'MediaClipRef',
      ]
    );
  }

  /**
   * Get timeline recommendations by query hash
   * Retrieves all recommendations for a specific query hash, sorted by rank and score.
   * This is useful for context-based retrieval where recommendations are generated
   * for a specific query context.
   * @param queryHash The query hash (deterministic hash for the recommendation query)
   * @param options Optional filtering options
   * @param options.excludeAccepted Exclude accepted recommendations (default: false)
   * @param options.excludeDismissed Exclude dismissed recommendations (default: false)
   * @param options.strategy Filter by recommendation strategy
   * @param options.targetMode Filter by target mode
   * @param options.minScore Minimum score threshold
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   * @returns List of timeline recommendations for the query hash, sorted by rank
   */
  async getByQueryHash(
    queryHash: string,
    options?: {
      excludeAccepted?: boolean;
      excludeDismissed?: boolean;
      strategy?: RecommendationStrategy;
      targetMode?: RecommendationTargetMode;
      minScore?: number;
    },
    page = 1,
    perPage = 100
  ): Promise<ListResult<TimelineRecommendation>> {
    const filters: string[] = [`queryHash = "${queryHash}"`];

    if (options) {
      if (options.excludeAccepted) {
        filters.push('acceptedAt = ""');
      }
      if (options.excludeDismissed) {
        filters.push('dismissedAt = ""');
      }
      if (options.strategy) {
        filters.push(`strategy = "${options.strategy}"`);
      }
      if (options.targetMode) {
        filters.push(`targetMode = "${options.targetMode}"`);
      }
      if (options.minScore !== undefined) {
        filters.push(`score >= ${options.minScore}`);
      }
    }

    return this.getList(
      page,
      perPage,
      filters,
      'rank,score', // Sort by rank first, then score
      [
        'WorkspaceRef',
        'TimelineRef',
        'TimelineClipsRef',
        'SeedClipRef',
        'MediaClipRef',
        'MediaClipRef.MediaRef',
        'MediaClipRef.MediaRef.spriteFileRef',
        'MediaClipRef.MediaRef.thumbnailFileRef',
      ]
    );
  }

  /**
   * Upsert a timeline recommendation based on queryHash and MediaClipRef
   * Uses the unique index (queryHash, MediaClipRef) for upsert behavior
   * @param input The recommendation input data
   * @returns The created or updated recommendation
   */
  async upsert(
    input: TimelineRecommendationInput
  ): Promise<TimelineRecommendation> {
    // First, try to find existing recommendation with same queryHash and MediaClipRef
    // Note: The index uses MediaClipRef, but we need to check MediaClipRef
    const existing = await this.getFirstByFilter(
      `queryHash = "${input.queryHash}" && MediaClipRef = "${input.MediaClipRef}"`
    );

    if (existing) {
      // Update existing recommendation
      // Transform input and remove MediaClipRef since it's already set
      const transformed = this.transformInputForCreate(input);
      // Remove fields that shouldn't be updated (id, created, updated)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, created, updated, ...updateData } = transformed;
      return this.update(
        existing.id,
        updateData as Partial<TimelineRecommendation>
      );
    } else {
      // Create new recommendation
      return this.create(input);
    }
  }

  /**
   * Get top recommendations by query hash
   * @param queryHash The query hash
   * @param limit Maximum number of recommendations to return (default: 10)
   * @returns List of top recommendations sorted by rank
   */
  async getTopByQueryHash(
    queryHash: string,
    limit = 10
  ): Promise<TimelineRecommendation[]> {
    const result = await this.getList(
      1,
      limit,
      `queryHash = "${queryHash}"`,
      'rank,score', // Sort by rank first, then score
      [
        'WorkspaceRef',
        'TimelineRef',
        'TimelineClipsRef',
        'SeedClipRef',
        'MediaClipRef',
      ]
    );
    return result.items;
  }

  /**
   * Get recommendations by timeline and strategy
   * @param timelineId The timeline ID
   * @param strategy The recommendation strategy
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   * @returns List of recommendations for the timeline and strategy
   */
  async getByTimelineAndStrategy(
    timelineId: string,
    strategy: RecommendationStrategy,
    page = 1,
    perPage = 100
  ): Promise<ListResult<TimelineRecommendation>> {
    return this.getList(
      page,
      perPage,
      `TimelineRef = "${timelineId}" && strategy = "${strategy}"`,
      'rank,score', // Sort by rank first, then score
      [
        'WorkspaceRef',
        'TimelineRef',
        'TimelineClipsRef',
        'SeedClipRef',
        'MediaClipRef',
      ]
    );
  }

  /**
   * Accept a recommendation and create a TimelineClip
   * Marks the recommendation as accepted, clears dismissed status if present,
   * and creates a TimelineClip from the recommended MediaClip
   * @param id The recommendation ID
   * @param options Optional parameters for timeline clip creation
   * @param options.order The order position in the timeline (if not provided, appends to end)
   * @returns Object containing the updated recommendation and created timeline clip
   */
  async acceptRecommendation(
    id: string,
    options?: { order?: number }
  ): Promise<{
    recommendation: TimelineRecommendation;
    timelineClip: TimelineClip;
  }> {
    // First, get the recommendation with expanded relations
    const recommendation = await this.getById(id, [
      'MediaClipRef',
      'MediaClipRef.MediaRef',
      'MediaClipRef.MediaRef.spriteFileRef',
      'MediaClipRef.MediaRef.thumbnailFileRef',
      'TimelineRef',
    ]);
    if (!recommendation) {
      throw new Error(`Recommendation ${id} not found`);
    }

    // Get the MediaClip to extract necessary data
    const mediaClip = recommendation.expand?.MediaClipRef as MediaClip;
    if (!mediaClip) {
      throw new Error(
        `MediaClip not found for recommendation ${id}. Ensure MediaClipRef is expanded.`
      );
    }

    // Import TimelineClipMutator dynamically to avoid circular dependencies
    const { TimelineClipMutator } = await import('./timeline-clip');
    const timelineClipMutator = new TimelineClipMutator(this.pb);

    // Determine the order position
    let clipOrder = options?.order;
    if (clipOrder === undefined) {
      // If no order specified, append to the end
      const maxOrder = await timelineClipMutator.getMaxOrder(
        recommendation.TimelineRef
      );
      clipOrder = maxOrder + 1;
    }

    // Create the TimelineClip
    const timelineClip = await timelineClipMutator.create({
      TimelineRef: recommendation.TimelineRef,
      MediaRef: mediaClip.MediaRef,
      MediaClipRef: mediaClip.id,
      order: clipOrder,
      start: mediaClip.start,
      end: mediaClip.end,
      duration: mediaClip.duration,
      meta: {
        fromRecommendation: true,
        recommendationId: id,
        recommendationStrategy: recommendation.strategy,
      },
    });

    // Mark the recommendation as accepted and link to the created TimelineClip
    const now = new Date().toISOString();

    // Update the recommendation to append this clip to TimelineClipsRef
    // Using the + modifier to append to the relation array
    try {
      await this.pb.collection('TimelineRecommendations').update(id, {
        acceptedAt: now,
        dismissedAt: null, // Clear dismissed status when accepting
        'TimelineClipsRef+': timelineClip.id, // Append to the relation array
      } as Record<string, unknown>);
    } catch (error) {
      // Log error but don't fail the operation
      console.error(
        `Failed to update recommendation ${id} with timeline clip ${timelineClip.id}:`,
        error
      );
    }

    // Get the updated recommendation
    const updatedRecommendation = await this.getById(id);
    if (!updatedRecommendation) {
      throw new Error(`Failed to retrieve updated recommendation ${id}`);
    }

    return {
      recommendation: updatedRecommendation,
      timelineClip,
    };
  }

  /**
   * Dismiss a recommendation
   * Marks the recommendation as dismissed and clears accepted status if present
   * @param id The recommendation ID
   * @returns Updated recommendation
   */
  async dismissRecommendation(id: string): Promise<TimelineRecommendation> {
    const now = new Date().toISOString();
    // Clear acceptedAt by setting to null (PocketBase handles null for optional fields)
    return this.update(id, {
      dismissedAt: now,
      acceptedAt: null, // Clear accepted status when dismissing
    } as unknown as Partial<TimelineRecommendation>);
  }

  /**
   * Get analytics for recommendation acceptance and dismissal rates
   * @param options Optional filtering options
   * @param options.workspaceRef Filter by workspace
   * @param options.timelineRef Filter by timeline
   * @param options.strategy Filter by specific strategy
   * @returns Analytics data with acceptance/dismissal rates per strategy
   */
  async getAnalytics(options?: {
    workspaceRef?: string;
    timelineRef?: string;
    strategy?: RecommendationStrategy;
  }): Promise<{
    overall: {
      total: number;
      accepted: number;
      dismissed: number;
      pending: number;
      acceptanceRate: number;
      dismissalRate: number;
    };
    byStrategy: Record<
      RecommendationStrategy,
      {
        total: number;
        accepted: number;
        dismissed: number;
        pending: number;
        acceptanceRate: number;
        dismissalRate: number;
      }
    >;
  }> {
    // Build filter for the query
    const filters: string[] = [];
    if (options?.workspaceRef) {
      filters.push(`WorkspaceRef = "${options.workspaceRef}"`);
    }
    if (options?.timelineRef) {
      filters.push(`TimelineRef = "${options.timelineRef}"`);
    }
    if (options?.strategy) {
      filters.push(`strategy = "${options.strategy}"`);
    }

    // Fetch all recommendations matching the filter
    // We need to get all items, so we'll use a large perPage value
    const allRecommendations: TimelineRecommendation[] = [];
    let page = 1;
    const perPage = 500;
    let hasMore = true;

    while (hasMore) {
      const result = await this.getList(page, perPage, filters);
      allRecommendations.push(...result.items);
      hasMore = result.items.length === perPage;
      page++;
    }

    // Calculate overall statistics
    const total = allRecommendations.length;
    const accepted = allRecommendations.filter((r) => r.acceptedAt).length;
    const dismissed = allRecommendations.filter((r) => r.dismissedAt).length;
    const pending = total - accepted - dismissed;

    const overall = {
      total,
      accepted,
      dismissed,
      pending,
      acceptanceRate: total > 0 ? accepted / total : 0,
      dismissalRate: total > 0 ? dismissed / total : 0,
    };

    // Calculate statistics by strategy
    const byStrategy: Record<
      RecommendationStrategy,
      {
        total: number;
        accepted: number;
        dismissed: number;
        pending: number;
        acceptanceRate: number;
        dismissalRate: number;
      }
    > = {} as Record<
      RecommendationStrategy,
      {
        total: number;
        accepted: number;
        dismissed: number;
        pending: number;
        acceptanceRate: number;
        dismissalRate: number;
      }
    >;

    // Group recommendations by strategy
    const strategyGroups = allRecommendations.reduce<
      Record<RecommendationStrategy, TimelineRecommendation[]>
    >(
      (acc, rec) => {
        const strategy = rec.strategy as RecommendationStrategy;
        if (!acc[strategy]) {
          acc[strategy] = [];
        }
        acc[strategy].push(rec);
        return acc;
      },
      {} as Record<RecommendationStrategy, TimelineRecommendation[]>
    );

    // Calculate statistics for each strategy
    for (const [strategy, recommendations] of Object.entries(strategyGroups)) {
      const strategyTotal = recommendations.length;
      const strategyAccepted = recommendations.filter(
        (r) => r.acceptedAt
      ).length;
      const strategyDismissed = recommendations.filter(
        (r) => r.dismissedAt
      ).length;
      const strategyPending =
        strategyTotal - strategyAccepted - strategyDismissed;

      byStrategy[strategy as RecommendationStrategy] = {
        total: strategyTotal,
        accepted: strategyAccepted,
        dismissed: strategyDismissed,
        pending: strategyPending,
        acceptanceRate:
          strategyTotal > 0 ? strategyAccepted / strategyTotal : 0,
        dismissalRate:
          strategyTotal > 0 ? strategyDismissed / strategyTotal : 0,
      };
    }

    return {
      overall,
      byStrategy,
    };
  }

  /**
   * Accept a recommendation (legacy method)
   * @deprecated Use acceptRecommendation() instead for full functionality
   * @param id The recommendation ID
   * @returns Updated recommendation
   */
  async accept(id: string): Promise<TimelineRecommendation> {
    const now = new Date().toISOString();
    // Clear dismissedAt by setting to null (PocketBase handles null for optional fields)
    return this.update(id, {
      acceptedAt: now,
      dismissedAt: null, // Clear dismissed status when accepting
    } as unknown as Partial<TimelineRecommendation>);
  }

  /**
   * Dismiss a recommendation (legacy method)
   * @deprecated Use dismissRecommendation() instead for consistency
   * @param id The recommendation ID
   * @returns Updated recommendation
   */
  async dismiss(id: string): Promise<TimelineRecommendation> {
    const now = new Date().toISOString();
    // Clear acceptedAt by setting to null (PocketBase handles null for optional fields)
    return this.update(id, {
      dismissedAt: now,
      acceptedAt: null, // Clear accepted status when dismissing
    } as unknown as Partial<TimelineRecommendation>);
  }

  /**
   * Mark a recommendation as accepted
   * @deprecated Use accept() instead. This method is kept for backward compatibility.
   * @param id The recommendation ID
   * @returns Updated recommendation
   */
  async markAccepted(id: string): Promise<TimelineRecommendation> {
    return this.accept(id);
  }

  /**
   * Mark a recommendation as dismissed
   * @deprecated Use dismiss() instead. This method is kept for backward compatibility.
   * @param id The recommendation ID
   * @returns Updated recommendation
   */
  async markDismissed(id: string): Promise<TimelineRecommendation> {
    return this.dismiss(id);
  }

  /**
   * Get accepted recommendations for a timeline
   * @param timelineId The timeline ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @returns List of accepted recommendations
   */
  async getAcceptedByTimeline(
    timelineId: string,
    page = 1,
    perPage = 50
  ): Promise<ListResult<TimelineRecommendation>> {
    return this.getList(
      page,
      perPage,
      `TimelineRef = "${timelineId}" && acceptedAt != ""`,
      '-acceptedAt', // Sort by most recently accepted first
      [
        'WorkspaceRef',
        'TimelineRef',
        'TimelineClipsRef',
        'SeedClipRef',
        'MediaClipRef',
      ]
    );
  }

  /**
   * Get dismissed recommendations for a timeline
   * @param timelineId The timeline ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @returns List of dismissed recommendations
   */
  async getDismissedByTimeline(
    timelineId: string,
    page = 1,
    perPage = 50
  ): Promise<ListResult<TimelineRecommendation>> {
    return this.getList(
      page,
      perPage,
      `TimelineRef = "${timelineId}" && dismissedAt != ""`,
      '-dismissedAt', // Sort by most recently dismissed first
      [
        'WorkspaceRef',
        'TimelineRef',
        'TimelineClipsRef',
        'SeedClipRef',
        'MediaClipRef',
      ]
    );
  }
}
