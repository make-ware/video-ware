import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
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
        'MediaRef.proxyFileRef',
        'MediaRef.thumbnailFileRef',
        'MediaRef.spriteFileRef',
        'MediaRef.filmstripFileRefs',
        'MediaClipRef',
        'CaptionRef',
        'SourceTimelineRef',
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
   * Get timeline clips by timeline.
   *
   * Every caller treats the result as the complete timeline — durations,
   * overlap checks, reflow, and rendering are all computed from it — so this
   * walks every page rather than capping. A previous single-page bound of 500
   * silently dropped clips past it, which read as a shorter timeline instead
   * of an error.
   *
   * @param timelineId The timeline ID
   * @returns Every timeline clip, sorted by order
   */
  async getByTimeline(timelineId: string): Promise<TimelineClip[]> {
    const perPage = 500;
    // `id` tiebreak: `order` uniqueness per timeline is only an app-level
    // convention (max(order)+1 on insert), so two clips can tie — without a
    // total order the OFFSET boundary between pages could duplicate or drop
    // one of them.
    const sort = 'order,id';
    const filter = `TimelineRef = "${timelineId}"`;
    // Page walk duplicated from the CLI's `fetchAllPages`
    // (cli/src/lib/list/paginate.ts) — shared/ cannot import cli/, so keep the
    // two in sync until a shared isomorphic helper exists.
    const first = await this.getList(1, perPage, filter, sort);
    const clips = [...first.items];
    for (let page = 2; page <= first.totalPages; page++) {
      const next = await this.getList(page, perPage, filter, sort);
      clips.push(...next.items);
    }
    return clips;
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
   * Get timeline clips by media
   * @param mediaId The media ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 500)
   * @returns List of timeline clips referencing this media
   */
  async getByMedia(
    mediaId: string,
    page = 1,
    perPage = 500
  ): Promise<ListResult<TimelineClip>> {
    return this.getList(page, perPage, `MediaRef = "${mediaId}"`);
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
    // Sequential on purpose: parallel writes interleave nondeterministically
    // with a concurrent editor's updates, and clip counts are small (≤500).
    const updated: TimelineClip[] = [];
    for (const { id, order } of clipOrders) {
      updated.push(await this.update(id, { order }));
    }
    return updated;
  }
}
