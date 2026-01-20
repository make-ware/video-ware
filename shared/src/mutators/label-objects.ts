import { BaseMutator } from './base';
import {
  LabelObject,
  LabelObjectInput,
  LabelObjectInputSchema,
} from '../schema/label-objects';
import { TypedPocketBase } from '../types';

export class LabelObjectMutator extends BaseMutator<
  LabelObject,
  LabelObjectInput
> {
  constructor(pb: TypedPocketBase) {
    super(pb);
  }

  protected getCollection() {
    return this.pb.collection('LabelObjects');
  }

  protected async validateInput(
    input: LabelObjectInput
  ): Promise<LabelObjectInput> {
    return LabelObjectInputSchema.parse(input);
  }

  async getByMedia(mediaId: string, page = 1, perPage = 100) {
    return this.getList(page, perPage, `MediaRef = "${mediaId}"`);
  }
}
