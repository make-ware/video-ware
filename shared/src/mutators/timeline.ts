import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { TimelineInputSchema } from '../schema';
import type { Timeline, TimelineInput } from '../schema';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';

export class TimelineMutator extends BaseMutator<Timeline, TimelineInput> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<Timeline> {
    return this.pb.collection('Timelines');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: ['WorkspaceRef', 'renderTaskRef', 'createdBy'],
      filter: [],
      sort: ['-created'], // Sort by created date descending by default
    };
  }

  protected async validateInput(input: TimelineInput): Promise<TimelineInput> {
    return TimelineInputSchema.parse(input);
  }

  /**
   * Get timelines by workspace
   * @param workspaceId The workspace ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @returns List of timelines for the workspace
   */
  async getByWorkspace(
    workspaceId: string,
    page = 1,
    perPage = 50
  ): Promise<ListResult<Timeline>> {
    return this.getList(page, perPage, `WorkspaceRef = "${workspaceId}"`);
  }

  /**
   * Increment the version number of a timeline
   * @param id The timeline ID
   * @returns Updated timeline with incremented version
   */
  async incrementVersion(id: string): Promise<Timeline> {
    const timeline = await this.getById(id);
    if (!timeline) {
      throw new Error(`Timeline not found: ${id}`);
    }
    return this.update(id, { version: (timeline.version ?? 1) + 1 });
  }
}
