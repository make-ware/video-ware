import { BaseMutator } from './base';
import { entityAttributionFilter } from './entity';
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

  /**
   * All face detections attributed to a real-world Entity, across media:
   * rows whose face track (preferred) or provider LabelEntity is linked to
   * it — "when is this person on screen".
   */
  async getByEntity(entityId: string, page = 1, perPage = 200) {
    return this.getList(
      page,
      perPage,
      entityAttributionFilter(entityId),
      'MediaRef,start',
      ['MediaRef', 'LabelTrackRef']
    );
  }
}
