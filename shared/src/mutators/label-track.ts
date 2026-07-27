import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { LabelTrackInputSchema } from '../schema';
import type { LabelTrack, LabelTrackInput } from '../schema';
import type { LabelType } from '../enums';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';
import { entityAttributionFilter } from './entity';

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

  // No default expand: a track list is often hundreds of rows per media, and
  // expanding MediaRef re-serializes the same Media record onto every one of
  // them. The handful of callers that need it ask explicitly.
  protected setDefaults(): MutatorOptions {
    return {
      expand: [],
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
   * A media's tracks of one label kind — its diarized speakers, its face
   * tracks.
   *
   * Always prefer this to filtering `getByMedia` client-side. LabelTrack
   * holds every label kind in one collection and object tracking alone emits
   * hundreds of rows per media, so an unfiltered page silently drops the
   * handful of rows a speaker- or face-identification UI is after. Served by
   * idx_label_track_media_type.
   * @param mediaId The media ID
   * @param labelType The label kind to return
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 200)
   */
  async getByMediaAndType(
    mediaId: string,
    labelType: LabelType,
    page = 1,
    perPage = 200
  ): Promise<ListResult<LabelTrack>> {
    return this.getList(
      page,
      perPage,
      `MediaRef = "${mediaId}" && labelType = "${labelType}"`
    );
  }

  // No setEntity here on purpose. LabelTrack.EntityRef still exists in
  // PocketBase as the pre-migration recovery net, but nothing reads it, so
  // writing it is a silent no-op that reports success. "This track is Erik"
  // is LabelEntityMutator.setEntity on the track's LabelEntityRef — the
  // per-media, per-instance row that every reader resolves through.

  /**
   * All tracks attributed to an entity, across media — each row is one
   * appearance range (start/end) of the entity in one media. Matched through
   * the track's own LabelEntity, the single link point.
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
      entityAttributionFilter(entityId),
      'MediaRef,start',
      ['MediaRef', 'LabelEntityRef']
    );
  }
}
