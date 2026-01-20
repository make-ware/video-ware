import { BaseMutator } from './base';
import {
  LabelFaceInput,
  LabelFace,
  LabelFaceInputSchema,
} from '../schema/label-face';
import { TypedPocketBase } from '../types';

export class LabelFaceMutator extends BaseMutator<LabelFace, LabelFaceInput> {
  constructor(pb: TypedPocketBase) {
    super(pb);
  }

  protected getCollection() {
    return this.pb.collection('LabelFaces');
  }

  protected async validateInput(
    input: LabelFaceInput
  ): Promise<LabelFaceInput> {
    return LabelFaceInputSchema.parse(input);
  }

  async getByMedia(mediaId: string, page = 1, perPage = 100) {
    return this.getList(page, perPage, `MediaRef = "${mediaId}"`);
  }
}
