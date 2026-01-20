import { RecordService } from 'pocketbase';
import { TimelineRenderInputSchema } from '../schema';
import type { TimelineRender, TimelineRenderInput } from '../schema';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';

export class TimelineRenderMutator extends BaseMutator<
  TimelineRender,
  TimelineRenderInput
> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<TimelineRender> {
    return this.pb.collection('TimelineRenders');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: ['TimelineRef', 'FileRef'],
      filter: [],
      sort: ['-created'], // Sort by created date descending by default
    };
  }

  protected async validateInput(
    input: TimelineRenderInput
  ): Promise<TimelineRenderInput> {
    return TimelineRenderInputSchema.parse(input);
  }

  /**
   * Get timeline renders by timeline
   * @param timelineId The timeline ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @returns List of timeline renders for the timeline
   */
  async getByTimeline(
    timelineId: string,
    page = 1,
    perPage = 50
  ): Promise<import('pocketbase').ListResult<TimelineRender>> {
    return this.getList(page, perPage, `TimelineRef = "${timelineId}"`);
  }

  /**
   * Get timeline renders by timeline version
   * @param timelineId The timeline ID
   * @param version The timeline version
   * @returns List of timeline renders for the specific version
   */
  async getByTimelineVersion(
    timelineId: string,
    version: number
  ): Promise<import('pocketbase').ListResult<TimelineRender>> {
    return this.getList(
      1,
      50,
      `TimelineRef = "${timelineId}" && version = ${version}`
    );
  }
}
