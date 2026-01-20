import { BaseMutator } from './base';
import {
  LabelShotInput,
  LabelShot,
  LabelShotInputSchema,
} from '../schema/label-shot';
import { TypedPocketBase } from '../types';

export class LabelShotMutator extends BaseMutator<LabelShot, LabelShotInput> {
  constructor(pb: TypedPocketBase) {
    super(pb);
  }

  protected getCollection() {
    return this.pb.collection('LabelShots');
  }

  protected async validateInput(
    input: LabelShotInput
  ): Promise<LabelShotInput> {
    return LabelShotInputSchema.parse(input);
  }

  async getByMedia(mediaId: string, page = 1, perPage = 100) {
    return this.getList(page, perPage, `MediaRef = "${mediaId}"`);
  }
}
