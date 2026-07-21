import { BaseMutator } from './base';
import {
  LabelSpeech,
  LabelSpeechInput,
  LabelSpeechInputSchema,
} from '../schema/label-speech';
import { TypedPocketBase } from '../types';

export class LabelSpeechMutator extends BaseMutator<
  LabelSpeech,
  LabelSpeechInput
> {
  constructor(pb: TypedPocketBase) {
    super(pb);
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
}
