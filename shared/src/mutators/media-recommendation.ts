import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { MediaRecommendationInputSchema } from '../schema';
import type { MediaRecommendation, MediaRecommendationInput } from '../schema';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';
import { LabelType, RecommendationStrategy } from '../enums';

/**
 * Options for searching media recommendations
 */
export interface MediaRecommendationSearchOptions {
  /** Filter by label type (e.g., 'object', 'shot', 'person', 'speech') */
  labelType?: LabelType;
  /** Filter by recommendation strategy */
  strategy?: RecommendationStrategy;
  /** Minimum score threshold (0-1) */
  minScore?: number;
  /** Maximum score threshold (0-1) */
  maxScore?: number;
  /** Minimum start time (seconds) */
  minTime?: number;
  /** Maximum end time (seconds) */
  maxTime?: number;
  /** Filter by media reference */
  mediaRef?: string;
  /** Filter by workspace reference */
  workspaceRef?: string;
  /** Filter by query hash */
  queryHash?: string;
}

export class MediaRecommendationMutator extends BaseMutator<
  MediaRecommendation,
  MediaRecommendationInput
> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<MediaRecommendation> {
    return this.pb.collection('MediaRecommendations');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: [
        'WorkspaceRef',
        'MediaRef',
        'MediaRef.spriteFileRef',
        'MediaRef.thumbnailFileRef',
        'MediaClipsRef',
      ],
      filter: [],
      sort: ['rank', 'start'], // Sort by rank first, then start time
    };
  }

  protected async validateInput(
    input: MediaRecommendationInput
  ): Promise<MediaRecommendationInput> {
    return MediaRecommendationInputSchema.parse(input);
  }

  /**
   * Build filter string from search options
   * @param options Search options
   * @returns Filter string for PocketBase query
   */
  private buildSearchFilter(
    options: MediaRecommendationSearchOptions
  ): string[] {
    const filters: string[] = [];

    // Filter by label type
    if (options.labelType) {
      filters.push(`labelType = "${options.labelType}"`);
    }

    // Filter by strategy
    if (options.strategy) {
      filters.push(`strategy = "${options.strategy}"`);
    }

    // Filter by score range
    if (options.minScore !== undefined) {
      filters.push(`score >= ${options.minScore}`);
    }
    if (options.maxScore !== undefined) {
      filters.push(`score <= ${options.maxScore}`);
    }

    // Filter by time window
    if (options.minTime !== undefined) {
      filters.push(`start >= ${options.minTime}`);
    }
    if (options.maxTime !== undefined) {
      filters.push(`end <= ${options.maxTime}`);
    }

    // Filter by media reference
    if (options.mediaRef) {
      filters.push(`MediaRef = "${options.mediaRef}"`);
    }

    // Filter by workspace reference
    if (options.workspaceRef) {
      filters.push(`WorkspaceRef = "${options.workspaceRef}"`);
    }

    // Filter by query hash
    if (options.queryHash) {
      filters.push(`queryHash = "${options.queryHash}"`);
    }

    return filters;
  }

  /**
   * Search media recommendations with filtering and pagination
   * @param options Search options
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @returns List of media recommendations matching the search criteria
   */
  async search(
    options: MediaRecommendationSearchOptions,
    page = 1,
    perPage = 50
  ): Promise<ListResult<MediaRecommendation>> {
    const filters = this.buildSearchFilter(options);
    return this.getList(
      page,
      perPage,
      filters,
      'rank,start', // Sort by rank first, then start time
      [
        'MediaRef',
        'MediaRef.spriteFileRef',
        'MediaRef.thumbnailFileRef',
        'WorkspaceRef',
        'MediaClipsRef',
      ]
    );
  }

  /**
   * Get media recommendations by media
   * Retrieves all recommendations for a specific media, sorted by rank and start time
   * @param mediaId The media ID
   * @param options Optional filtering options
   * @param options.labelType Filter by label type
   * @param options.strategy Filter by recommendation strategy
   * @param options.minScore Minimum score threshold (0-1)
   * @param options.maxScore Maximum score threshold (0-1)
   * @param options.minTime Minimum start time (seconds)
   * @param options.maxTime Maximum end time (seconds)
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   * @returns List of media recommendations for the media
   */
  async getByMedia(
    mediaId: string,
    options?: {
      labelType?: LabelType;
      strategy?: RecommendationStrategy;
      minScore?: number;
      maxScore?: number;
      minTime?: number;
      maxTime?: number;
    },
    page = 1,
    perPage = 100
  ): Promise<ListResult<MediaRecommendation>> {
    const filters: string[] = [`MediaRef = "${mediaId}"`];

    if (options) {
      if (options.labelType) {
        filters.push(`labelType = "${options.labelType}"`);
      }
      if (options.strategy) {
        filters.push(`strategy = "${options.strategy}"`);
      }
      if (options.minScore !== undefined) {
        filters.push(`score >= ${options.minScore}`);
      }
      if (options.maxScore !== undefined) {
        filters.push(`score <= ${options.maxScore}`);
      }
      if (options.minTime !== undefined) {
        filters.push(`start >= ${options.minTime}`);
      }
      if (options.maxTime !== undefined) {
        filters.push(`end <= ${options.maxTime}`);
      }
    }

    return this.getList(
      page,
      perPage,
      filters,
      'rank,start', // Sort by rank first, then start time
      [
        'MediaRef',
        'MediaRef.spriteFileRef',
        'MediaRef.thumbnailFileRef',
        'WorkspaceRef',
        'MediaClipsRef',
      ]
    );
  }

  /**
   * Get media recommendations by workspace
   * @param workspaceId The workspace ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @returns List of media recommendations for the workspace
   */
  async getByWorkspace(
    workspaceId: string,
    page = 1,
    perPage = 50
  ): Promise<ListResult<MediaRecommendation>> {
    return this.getList(
      page,
      perPage,
      `WorkspaceRef = "${workspaceId}"`,
      'rank,start', // Sort by rank first, then start time
      [
        'MediaRef',
        'MediaRef.spriteFileRef',
        'MediaRef.thumbnailFileRef',
        'WorkspaceRef',
        'MediaClipsRef',
      ]
    );
  }

  /**
   * Get media recommendations by query hash
   * Retrieves all recommendations for a specific query hash, sorted by rank and start time.
   * This is useful for context-based retrieval where recommendations are generated
   * for a specific query context.
   * @param queryHash The query hash (deterministic hash for the recommendation query)
   * @param options Optional filtering options
   * @param options.labelType Filter by label type
   * @param options.strategy Filter by recommendation strategy
   * @param options.minScore Minimum score threshold (0-1)
   * @param options.maxScore Maximum score threshold (0-1)
   * @param options.minTime Minimum start time (seconds)
   * @param options.maxTime Maximum end time (seconds)
   * @param options.mediaRef Filter by media reference
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   * @returns List of media recommendations for the query hash, sorted by rank
   */
  async getByQueryHash(
    queryHash: string,
    options?: {
      labelType?: LabelType;
      strategy?: RecommendationStrategy;
      minScore?: number;
      maxScore?: number;
      minTime?: number;
      maxTime?: number;
      mediaRef?: string;
    },
    page = 1,
    perPage = 100
  ): Promise<ListResult<MediaRecommendation>> {
    const filters: string[] = [`queryHash = "${queryHash}"`];

    if (options) {
      if (options.labelType) {
        filters.push(`labelType = "${options.labelType}"`);
      }
      if (options.strategy) {
        filters.push(`strategy = "${options.strategy}"`);
      }
      if (options.minScore !== undefined) {
        filters.push(`score >= ${options.minScore}`);
      }
      if (options.maxScore !== undefined) {
        filters.push(`score <= ${options.maxScore}`);
      }
      if (options.minTime !== undefined) {
        filters.push(`start >= ${options.minTime}`);
      }
      if (options.maxTime !== undefined) {
        filters.push(`end <= ${options.maxTime}`);
      }
      if (options.mediaRef) {
        filters.push(`MediaRef = "${options.mediaRef}"`);
      }
    }

    return this.getList(
      page,
      perPage,
      filters,
      'rank,start', // Sort by rank first, then start time
      [
        'MediaRef',
        'WorkspaceRef',
        'MediaRef.spriteFileRef',
        'MediaRef.thumbnailFileRef',
        'MediaClipsRef',
      ]
    );
  }

  /**
   * Upsert a media recommendation based on queryHash, start, and end
   * Uses the unique index (queryHash, start, end) for upsert behavior
   * @param input The recommendation input data
   * @returns The created or updated recommendation
   */
  async upsert(input: MediaRecommendationInput): Promise<MediaRecommendation> {
    // First, try to find existing recommendation with same queryHash, start, and end
    const existing = await this.getFirstByFilter(
      `queryHash = "${input.queryHash}" && start = ${input.start} && end = ${input.end}`
    );

    if (existing) {
      // Update existing recommendation
      return this.update(existing.id, input);
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
  ): Promise<MediaRecommendation[]> {
    const result = await this.getList(
      1,
      limit,
      `queryHash = "${queryHash}"`,
      'rank,start', // Sort by rank first, then start time
      [
        'MediaRef',
        'MediaRef.spriteFileRef',
        'MediaRef.thumbnailFileRef',
        'WorkspaceRef',
        'MediaClipsRef',
      ]
    );
    return result.items;
  }

  /**
   * Get recommendations by media and label type
   * @param mediaId The media ID
   * @param labelType The label type
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   * @returns List of recommendations for the media and label type
   */
  async getByMediaAndLabelType(
    mediaId: string,
    labelType: LabelType,
    page = 1,
    perPage = 100
  ): Promise<ListResult<MediaRecommendation>> {
    return this.getList(
      page,
      perPage,
      `MediaRef = "${mediaId}" && labelType = "${labelType}"`,
      'rank,start', // Sort by rank first, then start time
      [
        'MediaRef',
        'MediaRef.spriteFileRef',
        'MediaRef.thumbnailFileRef',
        'WorkspaceRef',
        'MediaClipsRef',
      ]
    );
  }

  /**
   * Filter recommendations by label type
   * Retrieves all recommendations matching a specific label type across all media
   * @param labelType The label type to filter by (e.g., 'object', 'shot', 'person', 'speech')
   * @param options Optional filtering options
   * @param options.strategy Filter by recommendation strategy
   * @param options.minScore Minimum score threshold (0-1)
   * @param options.maxScore Maximum score threshold (0-1)
   * @param options.minTime Minimum start time (seconds)
   * @param options.maxTime Maximum end time (seconds)
   * @param options.mediaRef Filter by specific media reference
   * @param options.workspaceRef Filter by workspace reference
   * @param options.queryHash Filter by query hash
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   * @returns List of recommendations filtered by label type, sorted by rank and start time
   */
  async filterByLabelType(
    labelType: LabelType,
    options?: {
      strategy?: RecommendationStrategy;
      minScore?: number;
      maxScore?: number;
      minTime?: number;
      maxTime?: number;
      mediaRef?: string;
      workspaceRef?: string;
      queryHash?: string;
    },
    page = 1,
    perPage = 100
  ): Promise<ListResult<MediaRecommendation>> {
    const filters: string[] = [`labelType = "${labelType}"`];

    if (options) {
      if (options.strategy) {
        filters.push(`strategy = "${options.strategy}"`);
      }
      if (options.minScore !== undefined) {
        filters.push(`score >= ${options.minScore}`);
      }
      if (options.maxScore !== undefined) {
        filters.push(`score <= ${options.maxScore}`);
      }
      if (options.minTime !== undefined) {
        filters.push(`start >= ${options.minTime}`);
      }
      if (options.maxTime !== undefined) {
        filters.push(`end <= ${options.maxTime}`);
      }
      if (options.mediaRef) {
        filters.push(`MediaRef = "${options.mediaRef}"`);
      }
      if (options.workspaceRef) {
        filters.push(`WorkspaceRef = "${options.workspaceRef}"`);
      }
      if (options.queryHash) {
        filters.push(`queryHash = "${options.queryHash}"`);
      }
    }

    return this.getList(
      page,
      perPage,
      filters,
      'rank,start', // Sort by rank first, then start time
      [
        'MediaRef',
        'MediaRef.spriteFileRef',
        'MediaRef.thumbnailFileRef',
        'WorkspaceRef',
        'MediaClipsRef',
      ]
    );
  }
}
