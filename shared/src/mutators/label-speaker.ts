import type { ListResult } from 'pocketbase';
import { BaseMutator } from './base';
import { entityAttributionFilter } from './entity';
import {
  LabelSpeaker,
  LabelSpeakerInput,
  LabelSpeakerInputSchema,
} from '../schema/label-speaker';
import type { LabelEntity } from '../schema/label-entity';
import type { LabelTrack } from '../schema/label-track';
import type { Expanded, TypedPocketBase } from '../types';

export interface LabelSpeakerRelations {
  LabelEntityRef?: LabelEntity;
  LabelTrackRef?: LabelTrack;
}

// Relations stays off the BaseMutator generics so getList keeps accepting
// arbitrary expand paths (the CLI passes dotted ones like
// "MediaRef.UploadRef"); getByMedia narrows its own expand instead.
export class LabelSpeakerMutator extends BaseMutator<
  LabelSpeaker,
  LabelSpeakerInput
> {
  constructor(pb: TypedPocketBase) {
    super(pb);
  }

  protected getCollection() {
    return this.pb.collection('LabelSpeaker');
  }

  protected async validateInput(
    input: LabelSpeakerInput
  ): Promise<LabelSpeakerInput> {
    return LabelSpeakerInputSchema.parse(input);
  }

  async getByMedia<E extends keyof LabelSpeakerRelations = never>(
    mediaId: string,
    page = 1,
    perPage = 100,
    expand?: E | E[]
  ): Promise<ListResult<Expanded<LabelSpeaker, LabelSpeakerRelations, E>>> {
    return this.getList(
      page,
      perPage,
      `MediaRef = "${mediaId}"`,
      'start',
      expand
    );
  }

  async getByMediaAndSpeaker(
    mediaId: string,
    speakerId: string,
    page = 1,
    perPage = 100
  ) {
    return this.getList(
      page,
      perPage,
      `MediaRef = "${mediaId}" && speakerId = "${speakerId}"`,
      'start'
    );
  }

  /**
   * All utterances attributed to a real-world Entity, across media: rows
   * whose speaker track (preferred) or provider LabelEntity is linked to it.
   * Sorted by media then start so consecutive rows read as a transcript.
   */
  async getByEntity(entityId: string, page = 1, perPage = 200) {
    return this.getList(
      page,
      perPage,
      entityAttributionFilter(entityId),
      'MediaRef,start',
      ['MediaRef']
    );
  }
}
