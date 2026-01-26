import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { TimelineTrackInputSchema } from '../schema';
import type { TimelineTrackRecord, TimelineTrackRecordInput } from '../schema';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';

export class TimelineTrackMutator extends BaseMutator<
  TimelineTrackRecord,
  TimelineTrackRecordInput
> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<TimelineTrackRecord> {
    return this.pb.collection('TimelineTracks');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: [],
      filter: [],
      sort: ['layer'], // Sort by layer ascending (0 is bottom)
    };
  }

  protected async validateInput(
    input: TimelineTrackRecordInput
  ): Promise<TimelineTrackRecordInput> {
    return TimelineTrackInputSchema.parse(input);
  }

  /**
   * Get tracks by timeline
   * @param timelineId The timeline ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @returns List of tracks for the timeline
   */
  async getByTimeline(
    timelineId: string,
    page = 1,
    perPage = 50
  ): Promise<ListResult<TimelineTrackRecord>> {
    return this.getList(page, perPage, `TimelineRef = "${timelineId}"`);
  }

  /**
   * Get the maximum layer number for a timeline
   * @param timelineId The timeline ID
   * @returns The maximum layer number, or -1 if no tracks exist
   */
  async getMaxLayer(timelineId: string): Promise<number> {
    const result = await this.getList(
      1,
      1,
      `TimelineRef = "${timelineId}"`,
      '-layer'
    );
    if (result.items.length === 0) {
      return -1;
    }
    return result.items[0].layer;
  }
}
