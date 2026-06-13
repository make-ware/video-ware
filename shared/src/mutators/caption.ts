import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { CaptionInputSchema } from '../schema';
import type { Caption, CaptionInput } from '../schema';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';

export class CaptionMutator extends BaseMutator<Caption, CaptionInput> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<Caption> {
    return this.pb.collection('Captions');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: [],
      filter: [],
      sort: ['-created'],
    };
  }

  protected async validateInput(input: CaptionInput): Promise<CaptionInput> {
    return CaptionInputSchema.parse(input);
  }

  /**
   * Get captions attached to a media object (transcript/TTS captions)
   */
  async getByMedia(
    mediaId: string,
    page = 1,
    perPage = 100
  ): Promise<ListResult<Caption>> {
    return this.getList(page, perPage, `MediaRef = "${mediaId}"`, 'start');
  }

  /**
   * Get captions in a workspace
   * @param workspaceId The workspace ID
   * @param adhocOnly When true, only user-created captions (no MediaRef)
   */
  async getByWorkspace(
    workspaceId: string,
    adhocOnly = false,
    page = 1,
    perPage = 100
  ): Promise<ListResult<Caption>> {
    const filter = adhocOnly
      ? this.pb.filter('WorkspaceRef = {:ws} && MediaRef = ""', {
          ws: workspaceId,
        })
      : this.pb.filter('WorkspaceRef = {:ws}', { ws: workspaceId });
    return this.getList(page, perPage, filter);
  }
}
