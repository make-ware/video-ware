import { BaseMutator } from './base';
import {
  LabelSegmentInput,
  LabelSegment,
  LabelSegmentInputSchema,
} from '../schema/label-segment';
import { TypedPocketBase } from '../types';

export class LabelSegmentMutator extends BaseMutator<
  LabelSegment,
  LabelSegmentInput
> {
  constructor(pb: TypedPocketBase) {
    super(pb);
  }

  protected getCollection() {
    return this.pb.collection('LabelSegments');
  }

  protected async validateInput(
    input: LabelSegmentInput
  ): Promise<LabelSegmentInput> {
    return LabelSegmentInputSchema.parse(input);
  }

  async getByMedia(mediaId: string, page = 1, perPage = 100) {
    return this.getList(page, perPage, `MediaRef = "${mediaId}"`);
  }
}
