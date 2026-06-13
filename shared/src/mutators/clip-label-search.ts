import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import type { ClipLabelSearch } from '../schema/clip-label-search';
import type { TypedPocketBase } from '../types';
import { BaseMutator } from './base';

/**
 * Read-only mutator over the `ClipLabelSearch` VIEW collection. Powers the
 * Objects / Tags / Transcripts tabs of universal search: each row is a clip
 * whose time window overlaps a matching label on the same media.
 */
export class ClipLabelSearchMutator extends BaseMutator<
  ClipLabelSearch,
  never
> {
  constructor(pb: TypedPocketBase) {
    super(pb);
  }

  protected getCollection(): RecordService<ClipLabelSearch> {
    return this.pb.collection('ClipLabelSearch');
  }

  // The view is read-only; nothing is ever created through this mutator.
  protected async validateInput(input: never): Promise<never> {
    return input;
  }

  /**
   * Search the view within a workspace for a category. Matches the label text
   * (`matchText ~ q`) and returns rows sorted by confidence (highest first).
   * The free-text `query` is bound via pb.filter to avoid injection. Multiple
   * rows can reference the same clip (one per overlapping label) — the caller
   * dedupes by `clipId`.
   */
  async searchByWorkspace(
    category: string,
    workspaceId: string,
    query: string,
    perPage = 40
  ): Promise<ListResult<ClipLabelSearch>> {
    const filter = this.pb.filter(
      'WorkspaceRef = {:ws} && category = {:cat} && matchText ~ {:q}',
      { ws: workspaceId, cat: category, q: query }
    );
    return this.getList(1, perPage, filter, '-confidence');
  }
}
