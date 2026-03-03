import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { DirectoryInputSchema } from '../schema';
import type { Directory, DirectoryInput, DirectoryRelations } from '../schema';
import type { Expanded, TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';

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
      expand: ['WorkspaceRef', 'ParentDirectoryRef'],
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
   * Get all directories in a workspace (flat list)
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
   * Get direct children of a directory
   */
  async getChildren<
    E extends keyof DirectoryRelations = keyof DirectoryRelations,
  >(
    parentId: string,
    page = 1,
    perPage = 50,
    expand?: E | E[]
  ): Promise<ListResult<Expanded<Directory, DirectoryRelations, E>>> {
    return this.getList(
      page,
      perPage,
      `ParentDirectoryRef = "${parentId}"`,
      undefined,
      expand
    );
  }

  /**
   * Get root directories in a workspace (no parent)
   */
  async getRootDirectories<
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
      [`WorkspaceRef = "${workspaceId}"`, `ParentDirectoryRef = ""`],
      undefined,
      expand
    );
  }

  /**
   * Rename a directory
   */
  async rename(id: string, name: string): Promise<Directory> {
    return this.update(id, { name } as Partial<Directory>);
  }

  /**
   * Delete a directory only if it has no children and no media
   * Throws if the directory is non-empty
   */
  async deleteIfEmpty(id: string): Promise<boolean> {
    // Check for child directories
    const children = await this.getList(1, 1, `ParentDirectoryRef = "${id}"`);
    if (children.totalItems > 0) {
      throw new Error('Cannot delete directory: it contains child directories');
    }

    // Check for media in this directory
    const media = await this.pb
      .collection('Media')
      .getList(1, 1, { filter: `DirectoryRef = "${id}"` });
    if (media.totalItems > 0) {
      throw new Error('Cannot delete directory: it contains media');
    }

    return this.delete(id);
  }
}
