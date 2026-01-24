import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type TypedPocketBase,
  type TaskStatus,
  type Media,
  type MediaInput,
  type TimelineRenderInput,
  type FileType,
  FileSource,
  type FileMetadata,
  FileStatus,
  FileInput,
  File,
  // Mutator classes
  UsageEventMutator,
  type UsageEventInput,
  FileMutator,
  LabelEntityMutator,
  LabelFaceMutator,
  LabelSpeechMutator,
  LabelTrackMutator,
  LabelSegmentMutator,
  LabelShotMutator,
  LabelObjectMutator,
  LabelPersonMutator,
  MediaClipMutator,
  MediaMutator,
  MediaRecommendationMutator,
  TaskMutator,
  TimelineClipMutator,
  TimelineMutator,
  TimelineRenderMutator,
  TimelineRecommendationMutator,
  UploadMutator,
  UserMutator,
  WatchedFileMutator,
  WorkspaceMutator,
} from '@project/shared';
import { PocketBaseClientService } from './pocketbase-client.service';
import { TaskResult } from '@/queue/processors';

@Injectable()
export class PocketBaseService implements OnModuleInit {
  private readonly logger = new Logger(PocketBaseService.name);
  private pb!: TypedPocketBase;

  // Mutators for data operations
  public usageEventMutator!: UsageEventMutator;
  public fileMutator!: FileMutator;
  public labelEntityMutator!: LabelEntityMutator;
  public mediaClipMutator!: MediaClipMutator;
  public mediaMutator!: MediaMutator;
  public taskMutator!: TaskMutator;
  public timelineClipMutator!: TimelineClipMutator;
  public timelineMutator!: TimelineMutator;
  public timelineRenderMutator!: TimelineRenderMutator;
  public mediaRecommendationMutator!: MediaRecommendationMutator;
  public timelineRecommendationMutator!: TimelineRecommendationMutator;
  public uploadMutator!: UploadMutator;
  public userMutator!: UserMutator;
  public watchedFileMutator!: WatchedFileMutator;
  public workspaceMutator!: WorkspaceMutator;
  public labelTrackMutator!: LabelTrackMutator;
  public labelFaceMutator!: LabelFaceMutator;
  public labelSpeechMutator!: LabelSpeechMutator;
  public labelSegmentMutator!: LabelSegmentMutator;
  public labelShotMutator!: LabelShotMutator;
  public labelObjectMutator!: LabelObjectMutator;
  public labelPersonMutator!: LabelPersonMutator;

  constructor(
    private readonly configService: ConfigService,
    private readonly pocketBaseClientService: PocketBaseClientService
  ) {}

  async onModuleInit() {
    await this.connect();
  }

  private async connect() {
    const url = this.configService.get<string>('pocketbase.url');
    const email = this.configService.get<string>('pocketbase.adminEmail');
    const password = this.configService.get<string>('pocketbase.adminPassword');

    if (!url || !email || !password) {
      throw new Error(
        'PocketBase configuration is incomplete. Please check POCKETBASE_URL, POCKETBASE_ADMIN_EMAIL, and POCKETBASE_ADMIN_PASSWORD environment variables.'
      );
    }

    this.pb = await this.pocketBaseClientService.createClient(url);
    this.pb.autoCancellation(false);

    try {
      // Use type assertion to access _superusers collection for admin auth
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.pb as any)
        .collection('_superusers')
        .authWithPassword(email, password, {
          autoRefreshThreshold: 30 * 60, // 30 minutes
        });

      this.logger.log(`Connected to PocketBase at ${url}`);

      // Initialize all mutators
      this.initializeMutators();
    } catch (error) {
      this.logger.error(
        `Failed to connect to PocketBase: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private initializeMutators() {
    this.usageEventMutator = new UsageEventMutator(this.pb);
    this.fileMutator = new FileMutator(this.pb);
    this.labelEntityMutator = new LabelEntityMutator(this.pb);
    this.labelTrackMutator = new LabelTrackMutator(this.pb);
    this.labelFaceMutator = new LabelFaceMutator(this.pb);
    this.labelSpeechMutator = new LabelSpeechMutator(this.pb);
    this.labelSegmentMutator = new LabelSegmentMutator(this.pb);
    this.labelShotMutator = new LabelShotMutator(this.pb);
    this.labelObjectMutator = new LabelObjectMutator(this.pb);
    this.labelPersonMutator = new LabelPersonMutator(this.pb);
    this.mediaRecommendationMutator = new MediaRecommendationMutator(this.pb);
    this.timelineRecommendationMutator = new TimelineRecommendationMutator(
      this.pb
    );
    this.mediaClipMutator = new MediaClipMutator(this.pb);
    this.mediaMutator = new MediaMutator(this.pb);
    this.taskMutator = new TaskMutator(this.pb);
    this.timelineClipMutator = new TimelineClipMutator(this.pb);
    this.timelineMutator = new TimelineMutator(this.pb);
    this.timelineRenderMutator = new TimelineRenderMutator(this.pb);
    this.uploadMutator = new UploadMutator(this.pb);
    this.userMutator = new UserMutator(this.pb);
    this.watchedFileMutator = new WatchedFileMutator(this.pb);
    this.workspaceMutator = new WorkspaceMutator(this.pb);

    this.logger.log('All mutators initialized successfully');
  }

  /**
   * Ensure mutators are initialized before use
   * If not initialized and PocketBase client is available, initialize them now
   */
  private ensureMutatorsInitialized() {
    if (!this.pb) {
      throw new Error(
        'PocketBase client is not initialized. Service may not be ready yet.'
      );
    }
    // Check if any mutator is missing (they're all initialized together)
    if (!this.uploadMutator || !this.fileMutator || !this.mediaMutator) {
      // Mutators not initialized yet, initialize them now
      this.initializeMutators();
    }
  }

  /**
   * Get the raw PocketBase client instance
   */
  getClient(): TypedPocketBase {
    return this.pb;
  }

  /**
   * Get an upload record by ID
   */
  async getUpload(uploadId: string) {
    try {
      // Ensure mutators are initialized
      this.ensureMutatorsInitialized();

      if (!this.uploadMutator) {
        throw new Error(
          'UploadMutator is not initialized. PocketBaseService may not be ready yet.'
        );
      }

      return await this.uploadMutator.getById(uploadId);
    } catch (error) {
      this.logger.error(
        `Failed to get upload ${uploadId}: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  /**
   * Get media record by upload ID
   */
  async getMediaByUpload(uploadId: string) {
    try {
      const results = await this.mediaMutator.getFirstByFilter(
        `UploadRef = "${uploadId}"`
      );
      return results || null;
    } catch (error) {
      this.logger.error(
        `Failed to get media for upload ${uploadId}: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  /**
   * Alias for getMediaByUpload for consistency
   */
  async findMediaByUpload(uploadId: string) {
    return this.getMediaByUpload(uploadId);
  }

  /**
   * Update media record
   */
  async updateMedia(mediaId: string, data: Partial<Media>) {
    try {
      return await this.mediaMutator.update(mediaId, data);
    } catch (error) {
      this.logger.error(
        `Failed to update media ${mediaId}: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Create or update media record
   */
  async createOrUpdateMedia(uploadId: string, data: Partial<MediaInput>) {
    try {
      const existing = await this.getMediaByUpload(uploadId);
      if (existing) {
        return await this.mediaMutator.update(
          existing.id,
          data as Partial<Media>
        );
      }
      return await this.mediaMutator.create({
        ...data,
        UploadRef: uploadId,
      } as MediaInput);
    } catch (error) {
      this.logger.error(
        `Failed to create/update media for upload ${uploadId}: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Health check method to verify PocketBase connectivity
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.pb.health.check();
      return true;
    } catch (error) {
      this.logger.warn(
        `PocketBase health check failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * Get task by ID
   */
  async getTask(taskId: string) {
    try {
      return await this.taskMutator.getById(taskId);
    } catch (error) {
      this.logger.error(
        `Failed to get task ${taskId}: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  /**
   * Update task status and progress
   */
  async updateTask(
    taskId: string,
    updates: {
      status?: TaskStatus;
      progress?: number;
      result?: TaskResult;
      error?: string;
    }
  ) {
    try {
      return await this.taskMutator.update(taskId, updates);
    } catch (error) {
      this.logger.error(
        `Failed to update task ${taskId}: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  async createFile(data: FileInput) {
    try {
      const record = await this.fileMutator.create(data);

      // Track storage usage
      await this.logUsageEvent({
        WorkspaceRef: data.WorkspaceRef,
        type: 'STORAGE',
        subtype:
          data.fileSource === FileSource.S3
            ? 'S3'
            : data.fileSource === FileSource.GCS
              ? 'GCS'
              : 'POCKETBASE',
        value: data.size,
        unit: 'BYTES',
        metadata: {
          fileId: record.id,
          fileType: data.fileType,
          fileName: data.name,
        },
      });

      return record;
    } catch (error) {
      this.logger.error(
        `Failed to create file record: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Get file record by ID
   */
  async getFile(fileId: string) {
    try {
      return await this.fileMutator.getById(fileId);
    } catch (error) {
      this.logger.error(
        `Failed to get file record ${fileId}: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  /**
   * Upload a file to PocketBase and create a File record
   */
  async uploadFile(params: {
    localFilePath: string;
    fileName: string;
    fileType: FileType;
    fileSource: FileSource;
    storageKey?: string;
    workspaceRef: string;
    uploadRef?: string;
    mediaRef?: string;
    mimeType: string;
    meta?: FileMetadata;
  }): Promise<File> {
    const {
      localFilePath,
      fileName,
      fileType,
      fileSource,
      storageKey,
      workspaceRef,
      uploadRef,
      mediaRef,
      mimeType,
      meta = {},
    } = params;

    try {
      const fs = await import('fs');
      const { Blob } = await import('buffer');

      // Read file from filesystem
      const fileBuffer = await fs.promises.readFile(localFilePath);
      const fileSize = fileBuffer.length;

      // Create a Blob from the buffer
      const blob = new Blob([fileBuffer], { type: mimeType });

      // Create FormData and append all fields
      const formData = new FormData();
      formData.append('name', fileName);
      formData.append('size', String(fileSize));
      formData.append('fileStatus', FileStatus.AVAILABLE);
      formData.append('fileType', fileType);
      formData.append('fileSource', fileSource);
      if (storageKey) {
        formData.append('s3Key', storageKey);
      }
      formData.append('WorkspaceRef', workspaceRef);
      if (uploadRef) {
        formData.append('UploadRef', uploadRef);
      }
      if (mediaRef) {
        formData.append('MediaRef', mediaRef);
      }
      formData.append('meta', JSON.stringify({ mimeType, ...meta }));

      // Append the actual file
      formData.append('file', blob as unknown as Blob, fileName);

      // Use PocketBase client directly to create with FormData
      const pb = this.getClient();
      const record = await pb.collection('Files').create(formData);

      // Track storage usage
      await this.logUsageEvent({
        WorkspaceRef: workspaceRef,
        type: 'STORAGE',
        subtype:
          fileSource === FileSource.S3
            ? 'S3'
            : fileSource === FileSource.GCS
              ? 'GCS'
              : 'POCKETBASE',
        value: fileSize,
        unit: 'BYTES',
        metadata: {
          fileId: record.id,
          fileType: fileType,
          fileName: fileName,
        },
      });

      return record;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to upload file and create record: ${errorMessage}`
      );
      throw error;
    }
  }

  /**
   * Get timeline record by ID
   */
  async getTimeline(timelineId: string) {
    try {
      return await this.timelineMutator.getById(timelineId);
    } catch (error) {
      this.logger.error(
        `Failed to get timeline ${timelineId}: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  /**
   * Get timeline clips for a timeline (returns all clips)
   */
  async getTimelineClips(timelineId: string) {
    return this.getAllTimelineClips(timelineId);
  }

  /**
   * Get timeline clips for a timeline with pagination
   */
  async getPaginatedTimelineClips(timelineId: string, page = 1, perPage = 100) {
    try {
      return await this.timelineClipMutator.getList(
        page,
        perPage,
        `TimelineRef = "${timelineId}"`
      );
    } catch (error) {
      this.logger.error(
        `Failed to get timeline clips for ${timelineId}: ${error instanceof Error ? error.message : String(error)}`
      );
      return {
        page,
        perPage,
        totalItems: 0,
        totalPages: 0,
        items: [],
      };
    }
  }

  /**
   * Get all timeline clips for a timeline (fetches all pages)
   */
  async getAllTimelineClips(timelineId: string) {
    try {
      const allItems = [];
      let page = 1;
      let totalPages = 1;

      do {
        const result = await this.getPaginatedTimelineClips(
          timelineId,
          page,
          500
        );
        allItems.push(...result.items);
        totalPages = result.totalPages;
        page++;
      } while (page <= totalPages);

      return allItems;
    } catch (error) {
      this.logger.error(
        `Failed to get all timeline clips for ${timelineId}: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  }

  /**
   * Get media record by ID
   */
  async getMedia(mediaId: string) {
    const result = await this.mediaMutator.getById(mediaId);
    if (!result) {
      throw new Error(`Media ${mediaId} not found`);
    }
    return result;
  }

  /**
   * Get upload by media ID
   */
  async getUploadByMedia(mediaId: string) {
    try {
      const results = await this.uploadMutator.getList(
        1,
        1,
        `Media_via_UploadRef.id = "${mediaId}"`
      );
      return results.items[0] || null;
    } catch (error) {
      this.logger.error(
        `Failed to get upload for media ${mediaId}: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  /**
   * Create media record
   */
  async createMedia(data: MediaInput) {
    try {
      return await this.mediaMutator.create(data);
    } catch (error) {
      this.logger.error(
        `Failed to create media record: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Create timeline render record
   */
  async createTimelineRender(data: TimelineRenderInput) {
    try {
      return await this.timelineRenderMutator.create(data);
    } catch (error) {
      this.logger.error(
        `Failed to create timeline render record: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Log a usage event
   */
  async logUsageEvent(input: UsageEventInput) {
    try {
      this.ensureMutatorsInitialized();
      await this.usageEventMutator.create(input);
    } catch (error) {
      this.logger.error(
        `Failed to log usage event: ${error instanceof Error ? error.message : String(error)}`
      );
      // Best effort - do not throw
    }
  }
}
