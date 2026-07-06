import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { LabelTrackInputSchema } from '../schema';
import type { LabelTrack, LabelTrackInput } from '../schema';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';
import { trackEntityAttributionFilter } from './entity';

export class LabelTrackMutator extends BaseMutator<
  LabelTrack,
  LabelTrackInput
> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<LabelTrack> {
    return this.pb.collection('LabelTrack');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: ['MediaRef'],
      filter: [],
      sort: ['-created'],
    };
  }

  protected async validateInput(
    input: LabelTrackInput
  ): Promise<LabelTrackInput> {
    return LabelTrackInputSchema.parse(input);
  }

  /**
   * Get media labels by media
   * @param mediaId The media ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @returns List of media labels for the media
   */
  async getByMedia(
    mediaId: string,
    page = 1,
    perPage = 50
  ): Promise<ListResult<LabelTrack>> {
    return this.getList(page, perPage, `MediaRef = "${mediaId}"`);
  }

  /**
   * Get the latest media label for a media item
   * @param mediaId The media ID
   * @returns The latest media label record or null if not found
   */
  async getLatestByMedia(mediaId: string): Promise<LabelTrack | null> {
    return this.getFirstByFilter(`MediaRef = "${mediaId}"`, '-created');
  }

  /**
   * Link (or, with null, unlink) a track to a real-world Entity. The track
   * is the per-media cluster — one face track, one diarized speaker — so
   * this is the "this track is Erik" operation. Track record ids are stable
   * across label re-runs (processors dedup by trackHash), so links survive
   * regeneration.
   * @param trackId The label track ID
   * @param entityId The entity ID, or null to unlink
   */
  async setEntity(
    trackId: string,
    entityId: string | null
  ): Promise<LabelTrack> {
    return this.update(trackId, {
      EntityRef: entityId ?? '',
    } as Partial<LabelTrack>);
  }

  /**
   * All tracks attributed to an entity, across media — each row is one
   * appearance range (start/end) of the entity in one media. Includes
   * tracks whose provider cluster (LabelEntity) is linked, unless the track
   * itself is linked elsewhere.
   * @param entityId The entity ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   */
  async getByEntity(
    entityId: string,
    page = 1,
    perPage = 100
  ): Promise<ListResult<LabelTrack>> {
    return this.getList(
      page,
      perPage,
      trackEntityAttributionFilter(entityId),
      'MediaRef,start',
      ['MediaRef', 'LabelEntityRef']
    );
  }
}
