import { RecordService } from 'pocketbase';
import type { EntityStats } from '../schema/entity-stats';
import type { TypedPocketBase } from '../types';
import { BaseMutator } from './base';

/**
 * Read-only mutator over the `EntityStats` VIEW collection: per-entity
 * cross-media rollups (media / tracked appearances / utterances / linked
 * labels) plus a representative thumbnail track. Powers the entities home
 * page's cards — one request per page of entities instead of ~10 per entity.
 */
export class EntityStatsMutator extends BaseMutator<EntityStats, never> {
  constructor(pb: TypedPocketBase) {
    super(pb);
  }

  protected getCollection(): RecordService<EntityStats> {
    return this.pb.collection('EntityStats');
  }

  // The view is read-only; nothing is ever created through this mutator.
  protected async validateInput(input: never): Promise<never> {
    return input;
  }

  /**
   * Stats rows for a set of entity ids (one page of cards) in one request.
   * Rows come back unordered relative to `entityIds`; callers key by id.
   */
  async getByEntityIds(entityIds: string[]): Promise<EntityStats[]> {
    if (entityIds.length === 0) return [];
    const filter = entityIds
      .map((id) => this.pb.filter('id = {:id}', { id }))
      .join(' || ');
    const result = await this.getList(1, entityIds.length, filter);
    return result.items;
  }
}
