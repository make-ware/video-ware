import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { WatchedFileInputSchema } from '../schema';
import { WatchedFileStatus } from '../enums';
import type { WatchedFile, WatchedFileInput } from '../schema';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';

export class WatchedFileMutator extends BaseMutator<
  WatchedFile,
  WatchedFileInput
> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<WatchedFile> {
    return this.pb.collection('WatchedFiles');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: ['WorkspaceRef', 'UploadRef'],
      filter: [],
      sort: ['-created'],
    };
  }

  protected async validateInput(
    input: WatchedFileInput
  ): Promise<WatchedFileInput> {
    return WatchedFileInputSchema.parse(input);
  }

  /**
   * Get a watched file by S3 key and bucket
   * @param s3Key The S3 object key
   * @param s3Bucket The S3 bucket name
   * @returns The watched file record or null if not found
   */
  async getByS3Key(
    s3Key: string,
    s3Bucket: string
  ): Promise<WatchedFile | null> {
    try {
      const filter = `s3Key = "${s3Key}" && s3Bucket = "${s3Bucket}"`;
      return await this.getFirstByFilter(filter);
    } catch (error) {
      return this.handleError(error, { allowNotFound: true });
    }
  }

  /**
   * Mark a watched file as processed
   * @param id The watched file ID
   * @param uploadId The associated upload ID
   * @returns The updated watched file
   */
  async markProcessed(id: string, uploadId: string): Promise<WatchedFile> {
    const updateData: Partial<WatchedFile> = {
      status: WatchedFileStatus.COMPLETED,
      UploadRef: uploadId,
      processedAt: new Date().toISOString(),
    };
    return this.update(id, updateData);
  }

  /**
   * Mark a watched file as failed
   * @param id The watched file ID
   * @param errorMessage The error message
   * @returns The updated watched file
   */
  async markFailed(id: string, errorMessage: string): Promise<WatchedFile> {
    const updateData: Partial<WatchedFile> = {
      status: WatchedFileStatus.FAILED,
      errorMessage,
      processedAt: new Date().toISOString(),
    };
    return this.update(id, updateData);
  }

  /**
   * Get watched files by workspace
   * @param workspaceId The workspace ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @returns List of watched files for the workspace
   */
  async getByWorkspace(
    workspaceId: string,
    page = 1,
    perPage = 50
  ): Promise<ListResult<WatchedFile>> {
    return this.getList(page, perPage, `WorkspaceRef = "${workspaceId}"`);
  }

  /**
   * Get watched files by status
   * @param status The status to filter by
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @returns List of watched files with the specified status
   */
  async getByStatus(
    status: WatchedFileStatus,
    page = 1,
    perPage = 50
  ): Promise<ListResult<WatchedFile>> {
    return this.getList(page, perPage, `status = "${status}"`);
  }

  /**
   * Update watched file status
   * @param id The watched file ID
   * @param status The new status
   * @param errorMessage Optional error message for failed status
   * @returns The updated watched file
   */
  async updateStatus(
    id: string,
    status: WatchedFileStatus,
    errorMessage?: string
  ): Promise<WatchedFile> {
    const updateData: Partial<WatchedFile> = { status };
    if (errorMessage) {
      updateData.errorMessage = errorMessage;
    }
    if (
      status === WatchedFileStatus.COMPLETED ||
      status === WatchedFileStatus.FAILED
    ) {
      updateData.processedAt = new Date().toISOString();
    }
    return this.update(id, updateData);
  }
}
