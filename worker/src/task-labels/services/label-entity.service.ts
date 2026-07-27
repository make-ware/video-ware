import { Injectable, Logger } from '@nestjs/common';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import {
  labelEntityKey,
  type LabelEntityInput,
  type LabelEntityMutator,
  LabelType,
  ProcessingProvider,
} from '@project/shared';
import type { LabelEntityData } from '../types';

/** One provider-detected instance to resolve to a LabelEntity record. */
export interface LabelEntityRequest {
  workspaceRef: string;
  /** The media this instance was detected in — part of the identity. */
  mediaId: string;
  labelType: LabelType;
  /** Display name, e.g. "Speaker 1", "Car". NOT part of the identity. */
  canonicalName: string;
  /**
   * The key for this instance within the media — the provider's trackId for
   * tracked types, which is what separates two same-named things in one
   * media; the normalized label name for shots and segments, which have no
   * track and whose instance is the class itself.
   */
  instanceId: string;
  provider:
    | ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE
    | ProcessingProvider.GOOGLE_SPEECH
    | ProcessingProvider.ELEVENLABS;
  processor: string;
  metadata?: Record<string, unknown>;
}

/**
 * Resolves provider detections to LabelEntity records — the per-media,
 * per-instance rows that carry the link to a real-world Entity.
 *
 * Identity is `(workspace, media, labelType, instanceId, provider)`. The media
 * and the instance are both load-bearing: keying on the canonical name alone,
 * as this did previously, collapsed every media's "Speaker 1" into one row, so
 * identifying a speaker in one video silently claimed the first speaker of
 * every other video.
 */
@Injectable()
export class LabelEntityService {
  private readonly logger = new Logger(LabelEntityService.name);
  private labelEntityMutator!: LabelEntityMutator;

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
   * Resolve one detected instance to a LabelEntity id, creating the record if
   * this is the first time it has been seen.
   *
   * Idempotent across re-runs: the key is derived entirely from stable inputs,
   * so re-labelling a media reuses its existing rows and the manual EntityRef
   * links on them survive.
   *
   * There is deliberately no in-memory cache. Keys are per-instance now, so
   * repeats within a run are rare enough that a cache earns nothing — and the
   * previous one lived on a singleton shared by every concurrently-running
   * media job, which cleared it out from under its neighbours.
   *
   * @returns The LabelEntity record id
   */
  async getOrCreateLabelEntity(request: LabelEntityRequest): Promise<string> {
    // Initialization guard: Ensure mutator is ready
    if (!this.labelEntityMutator) {
      throw new Error(
        'LabelEntityService is not initialized. labelEntityMutator is undefined.'
      );
    }

    const {
      workspaceRef,
      mediaId,
      labelType,
      canonicalName,
      instanceId,
      provider,
      processor,
      metadata,
    } = request;

    const entityHash = labelEntityKey({
      workspaceRef,
      mediaId,
      labelType,
      instanceId,
      provider,
    });

    try {
      const existing =
        await this.labelEntityMutator.getByEntityHash(entityHash);

      if (existing) {
        this.logger.debug(
          `Found existing entity: ${canonicalName} (${labelType}/${instanceId}) - ${existing.id}`
        );
        return existing.id;
      }

      const entityInput: LabelEntityInput = {
        WorkspaceRef: workspaceRef,
        MediaRef: mediaId,
        labelType,
        canonicalName: canonicalName.trim(), // Keep original casing for display
        provider,
        processor,
        instanceId,
        entityHash,
        metadata,
      };

      const created = await this.labelEntityMutator.create(entityInput);

      this.logger.debug(
        `Created new entity: ${canonicalName} (${labelType}/${instanceId}) - ${created.id}`
      );

      return created.id;
    } catch (error) {
      // Handle race condition: another process may have created the entity
      // between our check and our create attempt
      if (this.isUniqueConstraintError(error)) {
        this.logger.debug(
          `Unique constraint violation for ${canonicalName}, retrying lookup`
        );

        const retry = await this.labelEntityMutator.getByEntityHash(entityHash);

        if (retry) {
          this.logger.debug(
            `Found entity on retry: ${canonicalName} (${labelType}/${instanceId}) - ${retry.id}`
          );
          return retry.id;
        }

        // If we still can't find it, something is wrong
        this.logger.error(
          `Failed to find entity after unique constraint violation: ${canonicalName}`
        );
        throw new Error(
          `Failed to create or find entity: ${canonicalName} (${labelType}/${instanceId})`
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
   * Resolve a normalizer's whole batch of detected instances, returning a
   * lookup from instanceId to LabelEntity id.
   *
   * Every processor needs exactly this — entities first, then tracks and leaf
   * rows pointing at them — so the map is the handoff. Key by instanceId
   * rather than array position: a single failed upsert would otherwise shift
   * every later instance onto the wrong entity.
   */
  async resolveEntities(
    entities: LabelEntityData[]
  ): Promise<Map<string, string>> {
    const byInstance = new Map<string, string>();

    for (const entity of entities) {
      byInstance.set(
        entity.instanceId,
        await this.getOrCreateLabelEntity({
          workspaceRef: entity.WorkspaceRef,
          mediaId: entity.MediaRef,
          labelType: entity.labelType,
          canonicalName: entity.canonicalName,
          instanceId: entity.instanceId,
          provider: entity.provider as LabelEntityRequest['provider'],
          processor: entity.processor,
          metadata: entity.metadata,
        })
      );
    }

    return byInstance;
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
}
