import type { ListResult } from 'pocketbase';
import { BaseMutator, type MutatorOptions } from './base';
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

/**
 * LabelSpeaker columns the speaker transcript UIs actually read, as a
 * PocketBase `fields` projection. Deliberately omits `words` — the per-word
 * timing array is by far the heaviest column on the row and no speaker
 * surface touches it (the CLI's clip-transcript does, and does not use this
 * projection) — along with `metadata` and the dedup-only `speakerHash`.
 *
 * Two PocketBase rules shape this list. There is no exclusion syntax, so
 * every wanted field has to be named; and naming any field drops all expands
 * unless the expand paths are named too, hence the `expand.*` entries. The
 * nested `expand.LabelTrackRef.expand.EntityRef.*` mirrors the
 * `LabelTrackRef.EntityRef` expand that resolves "this speaker is Erik".
 *
 * Guarded by a drift test: a new LabelSpeaker column must be added here or
 * listed as intentionally omitted.
 */
export const SPEAKER_PANEL_FIELDS = [
  'id',
  'collectionId',
  'collectionName',
  'created',
  'updated',
  'WorkspaceRef',
  'MediaRef',
  'LabelTrackRef',
  'LabelEntityRef',
  'transcript',
  'languageCode',
  'start',
  'end',
  'duration',
  'speakerId',
  'confidence',
  'expand.LabelEntityRef.*',
  'expand.LabelTrackRef.*',
  'expand.LabelTrackRef.expand.EntityRef.*',
] as const;

/**
 * LabelSpeaker columns SPEAKER_PANEL_FIELDS drops on purpose. Kept explicit
 * so the drift test can tell "deliberately omitted" from "forgot to add".
 */
export const SPEAKER_PANEL_OMITTED_FIELDS = [
  'words',
  'metadata',
  'speakerHash',
  // Not a column — baseSchema models the expand container itself, which the
  // projection addresses through its `expand.*` paths.
  'expand',
] as const;

// Relations stays off the BaseMutator generics so getList keeps accepting
// arbitrary expand paths (the CLI passes dotted ones like
// "MediaRef.UploadRef"); getByMedia narrows its own expand instead.
export class LabelSpeakerMutator extends BaseMutator<
  LabelSpeaker,
  LabelSpeakerInput
> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
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

  /**
   * Every utterance in a media, sorted by start — the whole diarized
   * transcript, fetched in batches so a long recording can't be truncated.
   * @param mediaId The media ID
   * @param expand Relations to expand (dotted paths allowed)
   */
  async getAllByMedia(
    mediaId: string,
    expand?: string | string[]
  ): Promise<LabelSpeaker[]> {
    return this.getFullList(`MediaRef = "${mediaId}"`, 'start', expand);
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
