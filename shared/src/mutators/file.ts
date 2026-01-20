import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { FileInputSchema } from '../schema';
import type { File, FileInput } from '../schema';
import type { TypedPocketBase } from '../types';
import { FileType } from '../enums';
import { BaseMutator, type MutatorOptions } from './base';

export class FileMutator extends BaseMutator<File, FileInput> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<File> {
    return this.pb.collection('Files');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: ['WorkspaceRef', 'UploadRef', 'MediaRef'],
      filter: [],
      sort: ['-created'],
    };
  }

  protected async validateInput(input: FileInput): Promise<FileInput> {
    return FileInputSchema.parse(input);
  }

  /**
   * Get file URL using PocketBase file URL methods
   * @param file The file record
   * @param filename The filename field (default: 'blob')
   * @returns The file URL
   */
  getFileUrl(file: File, filename = 'blob'): string {
    return this.pb.files.getURL(file, filename);
  }

  /**
   * Get files by upload
   * @param uploadId The upload ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   * @returns List of files for the upload
   */
  async getByUpload(
    uploadId: string,
    page = 1,
    perPage = 100
  ): Promise<ListResult<File>> {
    return this.getList(page, perPage, `UploadRef = "${uploadId}"`);
  }

  /**
   * Get files by media
   * @param mediaId The media ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   * @returns List of files for the media
   */
  async getByMedia(
    mediaId: string,
    page = 1,
    perPage = 100
  ): Promise<ListResult<File>> {
    return this.getList(page, perPage, `MediaRef = "${mediaId}"`);
  }

  /**
   * Get the original file for an upload
   * @param uploadId The upload ID
   * @returns The original file record or null if not found
   */
  async getOriginalByUpload(uploadId: string): Promise<File | null> {
    return this.getFirstByFilter(
      `UploadRef = "${uploadId}" && fileType = "${FileType.ORIGINAL}"`
    );
  }
}
