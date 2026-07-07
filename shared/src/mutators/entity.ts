import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { EntityInputSchema } from '../schema';
import type { Entity, EntityInput } from '../schema';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';
import { EntityKind } from '../enums';

/**
 * PB filter matching label rows attributed to an entity, applying the
 * precedence rule: an explicit per-media track link wins; the provider
 * cluster (LabelEntity) link only applies to rows whose track is unlinked.
 * Works for any label collection carrying LabelTrackRef + LabelEntityRef.
 */
export function entityAttributionFilter(entityId: string): string {
  return (
    `(LabelTrackRef.EntityRef = "${entityId}" || ` +
    `(LabelTrackRef.EntityRef = "" && LabelEntityRef.EntityRef = "${entityId}"))`
  );
}

/**
 * The same precedence rule expressed for the LabelTrack collection itself,
 * where the two link points are the track's own EntityRef and its provider
 * cluster's LabelEntityRef.EntityRef. Each matching track is one appearance
 * range (start/end) of the entity in one media.
 */
export function trackEntityAttributionFilter(entityId: string): string {
  return (
    `(EntityRef = "${entityId}" || ` +
    `(EntityRef = "" && LabelEntityRef.EntityRef = "${entityId}"))`
  );
}

/**
 * Attribution filter for label collections that have no LabelTrackRef field
 * (LabelShot, LabelSegment): the provider cluster's Entity link is the only
 * link point, so referencing LabelTrackRef there would be a PocketBase
 * unknown-field error. Use entityAttributionFilter for collections that
 * carry a track.
 */
export function clusterEntityAttributionFilter(entityId: string): string {
  return `LabelEntityRef.EntityRef = "${entityId}"`;
}

export class EntityMutator extends BaseMutator<Entity, EntityInput> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<Entity> {
    return this.pb.collection('Entities');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: [],
      filter: [],
      sort: ['name'],
    };
  }

  protected async validateInput(input: EntityInput): Promise<EntityInput> {
    return EntityInputSchema.parse(input);
  }

  /**
   * List a workspace's entities, optionally narrowed to one kind
   * @param workspaceId The workspace ID
   * @param kind Optional entity kind filter
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   */
  async getByWorkspace(
    workspaceId: string,
    kind?: EntityKind,
    page = 1,
    perPage = 100
  ): Promise<ListResult<Entity>> {
    const filters = [`WorkspaceRef = "${workspaceId}"`];
    if (kind) {
      filters.push(`kind = "${kind}"`);
    }
    return this.getList(page, perPage, filters, 'name');
  }

  /**
   * Exact-name lookup within a workspace (any kind)
   * @param workspaceId The workspace ID
   * @param name The entity name
   * @returns The entity or null if not found
   */
  async getByName(workspaceId: string, name: string): Promise<Entity | null> {
    return this.getFirstByFilter(
      this.pb.filter('WorkspaceRef = {:ws} && name = {:name}', {
        ws: workspaceId,
        name,
      })
    );
  }

  /**
   * Fuzzy search on name, aliases, and description
   * @param workspaceId The workspace ID
   * @param query Free-text query
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   */
  async search(
    workspaceId: string,
    query: string,
    page = 1,
    perPage = 50
  ): Promise<ListResult<Entity>> {
    const filter = this.pb.filter(
      'WorkspaceRef = {:ws} && (name ~ {:q} || aliases ~ {:q} || description ~ {:q})',
      { ws: workspaceId, q: query }
    );
    return this.getList(page, perPage, filter, 'name');
  }
}
