import { BaseMutator } from './base';
import {
  LabelText,
  LabelTextInput,
  LabelTextInputSchema,
} from '../schema/label-text';
import type { TypedPocketBase } from '../types';

export class LabelTextMutator extends BaseMutator<LabelText, LabelTextInput> {
  constructor(pb: TypedPocketBase) {
    super(pb);
  }

  protected getCollection() {
    return this.pb.collection('LabelText');
  }

  protected async validateInput(
    input: LabelTextInput
  ): Promise<LabelTextInput> {
    return LabelTextInputSchema.parse(input);
  }

  async getByMedia(mediaId: string, page = 1, perPage = 100) {
    return this.getList(page, perPage, `MediaRef = "${mediaId}"`);
  }
}
