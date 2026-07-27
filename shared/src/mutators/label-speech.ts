import { BaseMutator, type MutatorOptions } from './base';
import {
  LabelSpeech,
  LabelSpeechInput,
  LabelSpeechInputSchema,
} from '../schema/label-speech';
import type { TypedPocketBase } from '../types';

export class LabelSpeechMutator extends BaseMutator<
  LabelSpeech,
  LabelSpeechInput
> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection() {
    return this.pb.collection('LabelSpeech');
  }

  protected async validateInput(
    input: LabelSpeechInput
  ): Promise<LabelSpeechInput> {
    return LabelSpeechInputSchema.parse(input);
  }

  async getByMedia(mediaId: string, page = 1, perPage = 100) {
    return this.getList(page, perPage, `MediaRef = "${mediaId}"`);
  }

  /**
   * Every speech segment in a media, sorted by start — the whole transcript,
   * fetched in batches so a long recording can't be truncated. The paged
   * surfaces use getByMedia; this is for the "give me the full text" reads
   * (raw transcript view, copy to clipboard), which should pair it with a
   * `fields` projection so the heavy per-word timings stay on the server.
   */
  async getAllByMedia(mediaId: string): Promise<LabelSpeech[]> {
    return this.getFullList(`MediaRef = "${mediaId}"`, 'start');
  }
}
