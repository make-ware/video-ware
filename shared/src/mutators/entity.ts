import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { EntityInputSchema, EntityPatchSchema } from '../schema';
import type { Entity, EntityInput, EntityPatch } from '../schema';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';
import { EntityKind } from '../enums';

/**
 * PB filter matching rows attributed to an entity.
 *
 * One hop, one shape, for every collection that carries a LabelEntityRef —
 * all eight leaf label types AND LabelTrack itself. LabelEntity is the single
 * link point: it is per-media and per-instance, so there is nothing left to
 * take precedence over.
 *
 * This replaced three separate filters encoding a two-level precedence rule
 * (track link wins, cluster link is the fallback, plus a third variant for
 * the two collections with no track at all). That rule was written out in
 * eight places across PB filters, two view definitions, the webapp and the
 * CLI; keeping them in agreement was a standing liability. Existing links
 * were folded into LabelEntity.EntityRef by the per-instance migration, so
 * this filter returns exactly what the old precedence chain returned.
 */
export function entityAttributionFilter(entityId: string): string {
  return `LabelEntityRef.EntityRef = "${entityId}"`;
}

/**
 * Server ordering for every entity listing.
 *
 * The `id` tiebreak is what makes load-more paging safe: `name` is unique only
 * per (WorkspaceRef, kind), so a listing that spans kinds has no total order
 * and SQLite may place equal-named rows differently per page — dropping or
 * duplicating records across page boundaries. Offset pagination hid this
 * because each page was read independently; an accumulating list does not.
 */
const ENTITY_LIST_SORT = 'name,id';

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
   * Patch an entity's editable fields.
   *
   * `BaseMutator.update` runs no Zod validation — only `create` does — so the
   * patch is parsed here. That is what stops a UI from clearing `name` to ''
   * or moving the record to another workspace.
   *
   * Deliberately a plain update rather than `updateWithGuard`: entities are
   * small workspace-level records with no concurrent-editor story, so the
   * guard's extra read would buy a RecordConflictError nothing surfaces.
   *
   * @param id The entity ID
   * @param patch The fields to change; absent fields are left untouched
   */
  async updateEntity(id: string, patch: EntityPatch): Promise<Entity> {
    const parsed = EntityPatchSchema.parse(patch);
    return this.update(id, parsed as Partial<Entity>);
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
    return this.getList(page, perPage, filters, ENTITY_LIST_SORT);
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
   * @param kind Optional entity kind filter
   */
  async search(
    workspaceId: string,
    query: string,
    page = 1,
    perPage = 50,
    kind?: EntityKind
  ): Promise<ListResult<Entity>> {
    const filter = this.pb.filter(
      'WorkspaceRef = {:ws} && (name ~ {:q} || aliases ~ {:q} || description ~ {:q})' +
        (kind ? ' && kind = {:kind}' : ''),
      { ws: workspaceId, q: query, ...(kind ? { kind } : {}) }
    );
    return this.getList(page, perPage, filter, ENTITY_LIST_SORT);
  }
}
