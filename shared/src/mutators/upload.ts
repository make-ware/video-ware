import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { UploadInputSchema, type MediaInput } from '../schema';
import { MediaType, ProcessingProvider, UploadStatus } from '../enums';
import type { Upload, UploadInput, Task, Media } from '../schema';
import type { TypedPocketBase } from '../types';
import type { LabelsFlowConfig, TranscodeFlowConfig } from '../jobs';
import type { DetectLabelsPayload, ProcessUploadPayload } from '../types';
import { BaseMutator, type MutatorOptions } from './base';
import { TaskMutator } from './task';

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
   * Create a processing task that will transcode and then enqueue label detection
   * @param uploadId The upload ID
   * @param userId Optional user ID override
   * @param transcodeConfig Optional transcode config overrides
   * @param labelsConfig Optional labels config overrides
   * @returns The created processing task
   */
  async processUploadAndDetectLabels(
    uploadId: string,
    userId?: string,
    transcodeConfig?: TranscodeFlowConfig,
    labelsConfig?: LabelsFlowConfig
  ): Promise<Task> {
    const upload = await this.getById(uploadId);
    if (!upload) {
      throw new Error(`Upload not found: ${uploadId}`);
    }

    const currentUserId =
      userId || (upload.UserRef as string) || this.pb.authStore.record?.id;
    if (!currentUserId) {
      throw new Error('User context required for task creation');
    }

    // Check for existing media first (idempotency for retries)
    let media: Media | null = null;
    try {
      media = await this.pb
        .collection('Media')
        .getFirstListItem<Media>(`UploadRef="${uploadId}"`);
    } catch {
      // Ignore error, media does not exist
    }

    if (!media) {
      // Initialize dummy media data for validation
      const dummyMediaData = {
        width: 0,
        height: 0,
        duration: 0,
        bitrate: 0,
        codec: '',
        format: '',
        fps: 0,
        size: 0,
        mediaDate: new Date().toISOString(),
        video: {
          codec: '',
          profile: '',
          width: 0,
          height: 0,
          pixFmt: '',
          level: '',
          colorSpace: '',
        },
        audio: {
          bitrate: 0,
          channels: 0,
          codec: '',
          sampleRate: '0',
        },
      };

      // Create the Media record immediately
      const mediaInput: MediaInput = {
        WorkspaceRef: upload.WorkspaceRef,
        UploadRef: uploadId,
        mediaType: MediaType.VIDEO, // Default to VIDEO
        mediaDate: new Date().toISOString(),
        duration: 0,
        width: 0,
        height: 0,
        aspectRatio: 0,
        mediaData: dummyMediaData,
        hasAudio: true,
        isActive: false,
        version: 1,
      };

      media = await this.pb.collection('Media').create(mediaInput);
    }

    if (!media) {
      throw new Error('Failed to create or retrieve media record');
    }

    const defaultTranscode: TranscodeFlowConfig = {
      provider: ProcessingProvider.FFMPEG,
      sprite: {
        fps: 1,
        cols: 10,
        rows: 10,
        tileWidth: 320,
        tileHeight: 180,
      },
      thumbnail: {
        timestamp: 'midpoint',
        width: 640,
        height: 360,
      },
      filmstrip: {
        cols: 100,
        rows: 1,
        tileWidth: 320,
        tileHeight: 180,
      },
      transcode: {
        enabled: true,
        codec: 'h265',
        resolution: '720p',
      },
      audio: {
        enabled: true,
        bitrate: '128k',
      },
    };

    const defaultLabels: LabelsFlowConfig = {
      confidenceThreshold: 0.5,
      detectObjects: true,
      detectLabels: true,
      detectFaces: true,
      detectPersons: true,
      detectSpeech: true,
    };

    const payload: ProcessUploadPayload = {
      uploadId,
      mediaId: media.id,
      ...defaultTranscode,
      ...transcodeConfig,
      labels: {
        ...defaultLabels,
        ...labelsConfig,
      },
    };

    const taskMutator = new TaskMutator(this.pb);

    // Enqueue Transcode Task
    const transcodeTask = await taskMutator.createProcessUploadTask(
      upload.WorkspaceRef as string,
      currentUserId,
      uploadId,
      payload
    );

    // Enqueue Detect Labels Task (Parallel)
    if (upload.externalPath) {
      const labelsPayload: DetectLabelsPayload = {
        mediaId: media.id,
        fileRef: upload.externalPath,
        provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        config: {
          ...defaultLabels,
          ...labelsConfig,
        },
      };

      await taskMutator.createDetectLabelsTask(
        upload.WorkspaceRef as string,
        currentUserId,
        media.id,
        labelsPayload
      );
    }

    return transcodeTask;
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
