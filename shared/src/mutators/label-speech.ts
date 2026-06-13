import { BaseMutator } from './base';
import {
  LabelSpeech,
  LabelSpeechInput,
  LabelSpeechInputSchema,
} from '../schema/label-speech';

export class LabelSpeechMutator extends BaseMutator<
  LabelSpeech,
  LabelSpeechInput
> {
  constructor(pb: any) {
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

  /**
   * Search transcripts within a workspace by spoken text.
   * Returns matches sorted by confidence (highest first). The free-text
   * `query` is bound via pb.filter to avoid filter-string injection.
   */
  async searchByWorkspace(workspaceId: string, query: string, perPage = 15) {
    const filter = this.pb.filter('WorkspaceRef = {:ws} && transcript ~ {:q}', {
      ws: workspaceId,
      q: query,
    });
    return this.getList(1, perPage, filter, '-confidence');
  }
}
