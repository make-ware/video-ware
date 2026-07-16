import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { DirectoryInputSchema, DirectoryNameSchema } from '../schema';
import type { Directory, DirectoryInput, DirectoryRelations } from '../schema';
import type { Expanded, TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';

/**
 * Directories are flat: no nesting, and a DB unique index keeps names unique
 * per workspace (case-insensitive).
 */
export class DirectoryMutator extends BaseMutator<
  Directory,
  DirectoryInput,
  DirectoryRelations
> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<Directory> {
    return this.pb.collection('Directories');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: ['WorkspaceRef'],
      filter: [],
      sort: ['name'],
    };
  }

  protected async validateInput(
    input: DirectoryInput
  ): Promise<DirectoryInput> {
    return DirectoryInputSchema.parse(input);
  }

  /**
   * Get all directories in a workspace
   */
  async getByWorkspace<
    E extends keyof DirectoryRelations = keyof DirectoryRelations,
  >(
    workspaceId: string,
    page = 1,
    perPage = 50,
    expand?: E | E[]
  ): Promise<ListResult<Expanded<Directory, DirectoryRelations, E>>> {
    return this.getList(
      page,
      perPage,
      `WorkspaceRef = "${workspaceId}"`,
      undefined,
      expand
    );
  }

  /**
   * Rename a directory (the new name is validated against the shared
   * path-safe name rule; update() alone would skip it)
   */
  async rename(id: string, name: string): Promise<Directory> {
    const parsed = DirectoryNameSchema.parse(name);
    return this.update(id, { name: parsed } as Partial<Directory>);
  }

  /**
   * Delete a directory only if no media is filed in it
   * Throws if the directory is non-empty
   */
  async deleteIfEmpty(id: string): Promise<boolean> {
    const media = await this.pb.collection('Media').getList(1, 1, {
      filter: this.pb.filter('DirectoryRef = {:id}', { id }),
    });
    if (media.totalItems > 0) {
      throw new Error('Cannot delete directory: it contains media');
    }

    return this.delete(id);
  }
}
