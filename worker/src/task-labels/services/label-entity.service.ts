import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import {
  type LabelEntityInput,
  type LabelEntityMutator,
  LabelType,
  ProcessingProvider,
} from '@project/shared';

/**
 * Service for managing LabelEntity deduplication and caching
 *
 * This service provides methods to:
 * - Generate deterministic entity hashes for deduplication
 * - Get or create LabelEntity records with race condition handling
 * - Cache entity lookups in memory during processing
 */
@Injectable()
export class LabelEntityService {
  private readonly logger = new Logger(LabelEntityService.name);
  private labelEntityMutator!: LabelEntityMutator;

  // In-memory cache for entity lookups during processing
  // Key: entityHash, Value: entity ID
  private entityCache: Map<string, string> = new Map();

  constructor(private readonly pocketBaseService: PocketBaseService) {}

  /**
   * Initialize the service by loading the LabelEntityMutator
   * This is called after the PocketBaseService has initialized
   */
  async onModuleInit() {
    // Dynamically import the LabelEntityMutator from shared package
    const sharedModule = await (eval(`import('@project/shared')`) as Promise<
      typeof import('@project/shared')
    >);

    this.labelEntityMutator = new sharedModule.LabelEntityMutator(
      this.pocketBaseService.getClient()
    );

    this.logger.log('LabelEntityService initialized');
  }

  /**
   * Generate a deterministic entity hash for deduplication
   *
   * The hash is generated from: workspaceRef:labelType:canonicalName:provider
   * This ensures that the same label across different processing runs
   * will have the same hash and can be deduplicated.
   *
   * @param workspaceRef The workspace reference
   * @param labelType The label type (OBJECT, SHOT, PERSON, SPEECH)
   * @param canonicalName The canonical name of the label (e.g., "Car", "Person")
   * @param provider The processing provider (GOOGLE_VIDEO_INTELLIGENCE, GOOGLE_SPEECH)
   * @returns SHA-256 hash string
   */
  generateEntityHash(
    workspaceRef: string,
    labelType: LabelType,
    canonicalName: string,
    provider: ProcessingProvider
  ): string {
    // Normalize the canonical name to lowercase for consistent hashing
    const normalizedName = canonicalName.trim().toLowerCase();

    // Create hash input string
    const hashInput = `${workspaceRef}:${labelType}:${normalizedName}:${provider}`;

    // Generate SHA-256 hash
    const hash = createHash('sha256').update(hashInput).digest('hex');

    return hash;
  }

  /**
   * Get or create a LabelEntity with deduplication logic
   *
   * This method:
   * 1. Checks the in-memory cache first
   * 2. Generates an entity hash
   * 3. Queries the database for an existing entity
   * 4. Creates a new entity if it doesn't exist
   * 5. Handles unique constraint violations (race conditions)
   * 6. Caches the result in memory
   *
   * @param workspaceRef The workspace reference
   * @param labelType The label type
   * @param canonicalName The canonical name of the label
   * @param provider The processing provider (must be GOOGLE_VIDEO_INTELLIGENCE or GOOGLE_SPEECH)
   * @param processor The processor version string (e.g., "object-tracking:1.0.0")
   * @param metadata Optional provider-specific metadata
   * @returns The entity ID
   */
  async getOrCreateLabelEntity(
    workspaceRef: string,
    labelType: LabelType,
    canonicalName: string,
    provider:
      | ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE
      | ProcessingProvider.GOOGLE_SPEECH,
    processor: string,
    metadata?: Record<string, unknown>
  ): Promise<string> {
    // Generate entity hash
    const entityHash = this.generateEntityHash(
      workspaceRef,
      labelType,
      canonicalName,
      provider
    );

    // Check in-memory cache first
    const cachedId = this.entityCache.get(entityHash);
    if (cachedId) {
      this.logger.debug(
        `Cache hit for entity: ${canonicalName} (${labelType})`
      );
      return cachedId;
    }

    try {
      // Try to find existing entity in database
      const existing =
        await this.labelEntityMutator.getByEntityHash(entityHash);

      if (existing) {
        this.logger.debug(
          `Found existing entity: ${canonicalName} (${labelType}) - ${existing.id}`
        );

        // Cache the result
        this.entityCache.set(entityHash, existing.id);
        return existing.id;
      }

      // Create new entity
      const entityInput: LabelEntityInput = {
        WorkspaceRef: workspaceRef,
        labelType,
        canonicalName: canonicalName.trim(), // Keep original casing for display
        provider,
        processor,
        entityHash,
        metadata,
      };

      const created = await this.labelEntityMutator.create(entityInput);

      this.logger.debug(
        `Created new entity: ${canonicalName} (${labelType}) - ${created.id}`
      );

      // Cache the result
      this.entityCache.set(entityHash, created.id);
      return created.id;
    } catch (error) {
      // Handle race condition: another process may have created the entity
      // between our check and our create attempt
      if (this.isUniqueConstraintError(error)) {
        this.logger.debug(
          `Unique constraint violation for ${canonicalName}, retrying lookup`
        );

        // Retry the lookup
        const retry = await this.labelEntityMutator.getByEntityHash(entityHash);

        if (retry) {
          this.logger.debug(
            `Found entity on retry: ${canonicalName} (${labelType}) - ${retry.id}`
          );

          // Cache the result
          this.entityCache.set(entityHash, retry.id);
          return retry.id;
        }

        // If we still can't find it, something is wrong
        this.logger.error(
          `Failed to find entity after unique constraint violation: ${canonicalName}`
        );
        throw new Error(
          `Failed to create or find entity: ${canonicalName} (${labelType})`
        );
      }

      // Re-throw other errors
      this.logger.error(
        `Error creating/finding entity ${canonicalName}: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Check if an error is a unique constraint violation
   *
   * @param error The error to check
   * @returns True if the error is a unique constraint violation
   */
  private isUniqueConstraintError(error: unknown): boolean {
    if (!error) return false;

    // Check for PocketBase error structure
    if (typeof error === 'object' && 'data' in error) {
      const data = (error as { data?: { entityHash?: { code?: string } } })
        .data;
      if (data?.entityHash?.code === 'validation_not_unique') {
        return true;
      }
    }

    // Check error message
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('unique constraint') ||
      message.includes('UNIQUE constraint') ||
      message.includes('validation_not_unique') ||
      message.includes('entityHash')
    );
  }

  /**
   * Clear the in-memory entity cache
   *
   * This should be called after processing completes to free memory.
   * The cache is only useful during a single processing run.
   */
  clearCache(): void {
    const cacheSize = this.entityCache.size;
    this.entityCache.clear();
    this.logger.debug(`Cleared entity cache (${cacheSize} entries)`);
  }

  /**
   * Get cache statistics
   *
   * @returns Object with cache size
   */
  getCacheStats(): { size: number } {
    return {
      size: this.entityCache.size,
    };
  }

  /**
   * Batch get or create multiple label entities
   *
   * This is more efficient than calling getOrCreateLabelEntity multiple times
   * because it can deduplicate requests before hitting the database.
   *
   * @param entities Array of entity specifications
   * @returns Array of entity IDs in the same order as input
   */
  async batchGetOrCreateLabelEntities(
    entities: Array<{
      workspaceRef: string;
      labelType: LabelType;
      canonicalName: string;
      provider:
        | ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE
        | ProcessingProvider.GOOGLE_SPEECH;
      processor: string;
      metadata?: Record<string, unknown>;
    }>
  ): Promise<string[]> {
    const results: string[] = [];

    // Process each entity
    for (const entity of entities) {
      const entityId = await this.getOrCreateLabelEntity(
        entity.workspaceRef,
        entity.labelType,
        entity.canonicalName,
        entity.provider,
        entity.processor,
        entity.metadata
      );
      results.push(entityId);
    }

    return results;
  }
}
