import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { MediaInputSchema } from '../schema';
import type { Media, MediaInput, MediaRelations } from '../schema';
import type { Expanded, TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';

export class MediaMutator extends BaseMutator<
  Media,
  MediaInput,
  MediaRelations
> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<Media> {
    return this.pb.collection('Media');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: [
        'WorkspaceRef',
        'UploadRef',
        'thumbnailFileRef',
        'spriteFileRef',
        'filmstripFileRefs',
        'proxyFileRef',
      ],
      filter: [],
      sort: ['-created'],
    };
  }

  protected async validateInput(input: MediaInput): Promise<MediaInput> {
    return MediaInputSchema.parse(input);
  }

  /**
   * Get media by workspace
   * @param workspaceId The workspace ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @param expand Optional expand fields to include
   * @returns List of media for the workspace
   */
  async getByWorkspace<E extends keyof MediaRelations = keyof MediaRelations>(
    workspaceId: string,
    page = 1,
    perPage = 50,
    expand?: E | E[]
  ): Promise<ListResult<Expanded<Media, MediaRelations, E>>> {
    return this.getList(
      page,
      perPage,
      `WorkspaceRef = "${workspaceId}"`,
      undefined,
      expand
    );
  }

  /**
   * Get media by upload
   * @param uploadId The upload ID
   * @param expand Optional expand fields to include
   * @returns The media record or null if not found
   */
  async getByUpload<E extends keyof MediaRelations = keyof MediaRelations>(
    uploadId: string,
    expand?: E | E[]
  ): Promise<Expanded<Media, MediaRelations, E> | null> {
    return this.getFirstByFilter(`UploadRef = "${uploadId}"`, expand);
  }
}
