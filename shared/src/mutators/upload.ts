import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { UploadInputSchema } from '../schema';
import { UploadStatus } from '../enums';
import type { Upload, UploadInput } from '../schema';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';

export class UploadMutator extends BaseMutator<Upload, UploadInput> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<Upload> {
    return this.pb.collection('Uploads');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: ['WorkspaceRef', 'UserRef'],
      filter: [],
      sort: ['-created'],
    };
  }

  protected async validateInput(input: UploadInput): Promise<UploadInput> {
    return UploadInputSchema.parse(input);
  }

  /**
   * Override create method to automatically set the UserRef field from authenticated user
   */
  async create(input: UploadInput): Promise<Upload> {
    try {
      // Get the authenticated user ID if not provided
      const userId =
        input.UserRef ||
        this.pb.authStore.record?.id ||
        this.pb.authStore.model?.id;
      if (!userId) {
        throw new Error('User must be authenticated to create uploads');
      }

      // Validate the input
      const validatedInput = await this.validateInput({
        ...input,
        UserRef: userId,
      });

      // Create the record
      const record = await this.entityCreate(validatedInput);
      return await this.processRecord(record);
    } catch (error) {
      return this.errorWrapper(error);
    }
  }

  /**
   * Create an upload with a file
   * @param input Upload input data
   * @param file The file to upload
   * @returns The created upload record
   */
  async createWithFile(input: UploadInput, file: File): Promise<Upload> {
    try {
      // Get the authenticated user ID if not provided
      const userId =
        input.UserRef ||
        this.pb.authStore.record?.id ||
        this.pb.authStore.model?.id;
      if (!userId) {
        throw new Error('User must be authenticated to create uploads');
      }

      // Validate input
      const validatedInput = await this.validateInput({
        ...input,
        UserRef: userId,
      });

      // Create FormData for file upload
      const formData = new FormData();
      formData.append('name', validatedInput.name);
      formData.append('size', String(validatedInput.size));
      formData.append('status', validatedInput.status);
      formData.append('WorkspaceRef', validatedInput.WorkspaceRef);
      formData.append('UserRef', validatedInput.UserRef!);

      if (validatedInput.errorMessage) {
        formData.append('errorMessage', validatedInput.errorMessage);
      }

      formData.append('originalFile', file);

      // Create the record with file
      const record = await this.getCollection().create(formData);
      return await this.processRecord(record);
    } catch (error) {
      return this.errorWrapper(error);
    }
  }

  /**
   * Get uploads by workspace
   * @param workspaceId The workspace ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @returns List of uploads for the workspace
   */
  async getByWorkspace(
    workspaceId: string,
    page = 1,
    perPage = 50
  ): Promise<ListResult<Upload>> {
    return this.getList(page, perPage, `WorkspaceRef = "${workspaceId}"`);
  }

  /**
   * Update upload status
   * @param id The upload ID
   * @param status The new status
   * @param errorMessage Optional error message for failed uploads
   * @returns The updated upload
   */
  async updateStatus(
    id: string,
    status: UploadStatus,
    errorMessage?: string
  ): Promise<Upload> {
    const updateData: Partial<Upload> = { status };
    if (errorMessage) {
      updateData.errorMessage = errorMessage;
    }
    return this.update(id, updateData);
  }
}
