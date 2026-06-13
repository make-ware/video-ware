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

  /**
   * Search segment tags within a workspace by entity name.
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
