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

  /**
   * Search detected objects within a workspace by entity name.
   * Returns matches sorted by confidence (highest first). The free-text
   * `query` is bound via pb.filter to avoid filter-string injection.
   */
  async searchByWorkspace(workspaceId: string, query: string, perPage = 15) {
    const filter = this.pb.filter('WorkspaceRef = {:ws} && entity ~ {:q}', {
      ws: workspaceId,
      q: query,
    });
    return this.getList(1, perPage, filter, '-confidence');
  }
}
