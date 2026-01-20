import { BaseMutator } from './base';
import {
  LabelPerson,
  LabelPersonInput,
  LabelPersonInputSchema,
} from '../schema/label-person';
import { TypedPocketBase } from '../types';

export class LabelPersonMutator extends BaseMutator<
  LabelPerson,
  LabelPersonInput
> {
  constructor(pb: TypedPocketBase) {
    super(pb);
  }

  protected getCollection() {
    return this.pb.collection('LabelPerson');
  }

  protected async validateInput(
    input: LabelPersonInput
  ): Promise<LabelPersonInput> {
    return LabelPersonInputSchema.parse(input);
  }

  async getByMedia(mediaId: string, page = 1, perPage = 100) {
    return this.getList(page, perPage, `MediaRef = "${mediaId}"`);
  }
}
