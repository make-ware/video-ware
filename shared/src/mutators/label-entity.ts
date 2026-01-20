import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { LabelEntityInputSchema } from '../schema';
import type { LabelEntity, LabelEntityInput } from '../schema';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';
import { LabelType, ProcessingProvider } from '../enums';

/**
 * Options for searching label entities
 */
export interface LabelEntitySearchOptions {
  /** Filter by label type (e.g., 'object', 'shot', 'person', 'speech') */
  labelType?: LabelType;
  /** Filter by canonical name */
  canonicalName?: string;
  /** Filter by provider */
  provider?: ProcessingProvider;
  /** Filter by processor */
  processor?: string;
  /** Filter by workspace reference */
  workspaceRef?: string;
  /** Filter by entity hash */
  entityHash?: string;
}

export class LabelEntityMutator extends BaseMutator<
  LabelEntity,
  LabelEntityInput
> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<LabelEntity> {
    return this.pb.collection('LabelEntity');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: ['WorkspaceRef'],
      filter: [],
      sort: ['canonicalName'], // Sort by canonical name by default
    };
  }

  protected async validateInput(
    input: LabelEntityInput
  ): Promise<LabelEntityInput> {
    return LabelEntityInputSchema.parse(input);
  }

  /**
   * Build filter string from search options
   * @param options Search options
   * @returns Filter string for PocketBase query
   */
  private buildSearchFilter(options: LabelEntitySearchOptions): string[] {
    const filters: string[] = [];

    // Filter by label type
    if (options.labelType) {
      filters.push(`labelType = "${options.labelType}"`);
    }

    // Filter by canonical name
    if (options.canonicalName) {
      filters.push(`canonicalName = "${options.canonicalName}"`);
    }

    // Filter by provider
    if (options.provider) {
      filters.push(`provider = "${options.provider}"`);
    }

    // Filter by processor
    if (options.processor) {
      filters.push(`processor = "${options.processor}"`);
    }

    // Filter by workspace reference
    if (options.workspaceRef) {
      filters.push(`WorkspaceRef = "${options.workspaceRef}"`);
    }

    // Filter by entity hash
    if (options.entityHash) {
      filters.push(`entityHash = "${options.entityHash}"`);
    }

    return filters;
  }

  /**
   * Search label entities with filtering and pagination
   * @param options Search options
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @returns List of label entities matching the search criteria
   */
  async search(
    options: LabelEntitySearchOptions,
    page = 1,
    perPage = 50
  ): Promise<ListResult<LabelEntity>> {
    const filters = this.buildSearchFilter(options);
    return this.getList(
      page,
      perPage,
      filters,
      'canonicalName', // Sort by canonical name ascending
      ['WorkspaceRef']
    );
  }

  /**
   * Get label entity by entity hash
   * @param entityHash The entity hash
   * @returns Label entity or null if not found
   */
  async getByEntityHash(entityHash: string): Promise<LabelEntity | null> {
    return this.getFirstByFilter(`entityHash = "${entityHash}"`);
  }

  /**
   * Get label entities by workspace
   * @param workspaceId The workspace ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @returns List of label entities for the workspace
   */
  async getByWorkspace(
    workspaceId: string,
    page = 1,
    perPage = 50
  ): Promise<ListResult<LabelEntity>> {
    return this.getList(
      page,
      perPage,
      `WorkspaceRef = "${workspaceId}"`,
      'canonicalName', // Sort by canonical name
      ['WorkspaceRef']
    );
  }

  /**
   * Get label entities by label type
   * @param labelType The label type
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @returns List of label entities for the label type
   */
  async getByLabelType(
    labelType: LabelType,
    page = 1,
    perPage = 50
  ): Promise<ListResult<LabelEntity>> {
    return this.getList(
      page,
      perPage,
      `labelType = "${labelType}"`,
      'canonicalName',
      ['WorkspaceRef']
    );
  }
}
