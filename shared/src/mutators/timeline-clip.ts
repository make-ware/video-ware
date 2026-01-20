import { RecordService } from 'pocketbase';
import { TimelineClipInputSchema } from '../schema';
import type { TimelineClip, TimelineClipInput } from '../schema';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';

export class TimelineClipMutator extends BaseMutator<
  TimelineClip,
  TimelineClipInput
> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<TimelineClip> {
    return this.pb.collection('TimelineClips');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: [
        'TimelineRef',
        'MediaRef',
        'MediaRef.UploadRef',
        'MediaRef.thumbnailFileRef',
        'MediaRef.spriteFileRef',
        'MediaRef.filmstripFileRefs',
        'MediaClipRef',
      ],
      filter: [],
      sort: ['order'], // Sort by order position by default
    };
  }

  protected async validateInput(
    input: TimelineClipInput
  ): Promise<TimelineClipInput> {
    return TimelineClipInputSchema.parse(input);
  }

  /**
   * Get timeline clips by timeline
   * @param timelineId The timeline ID
   * @returns List of timeline clips sorted by order
   */
  async getByTimeline(timelineId: string): Promise<TimelineClip[]> {
    const result = await this.getList(
      1,
      500, // Get all clips (reasonable max)
      `TimelineRef = "${timelineId}"`,
      'order' // Explicit sort by order
    );
    return result.items;
  }

  /**
   * Get the maximum order value for a timeline
   * @param timelineId The timeline ID
   * @returns Maximum order value, or -1 if no clips exist
   */
  async getMaxOrder(timelineId: string): Promise<number> {
    const clips = await this.getByTimeline(timelineId);
    if (clips.length === 0) {
      return -1;
    }
    return Math.max(...clips.map((c) => c.order));
  }

  /**
   * Reorder clips in a timeline
   * @param timelineId The timeline ID (for validation)
   * @param clipOrders Array of clip IDs with their new order positions
   * @returns Array of updated timeline clips
   */
  async reorderClips(
    timelineId: string,
    clipOrders: { id: string; order: number }[]
  ): Promise<TimelineClip[]> {
    const updates = clipOrders.map(({ id, order }) =>
      this.update(id, { order })
    );
    return Promise.all(updates);
  }
}
