import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { FFmpegProbeExecutor, FFmpegThumbnailExecutor } from '../executors';
import { StorageService } from '../../shared/services/storage.service';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { FileResolver } from '../utils/file-resolver';
import type {
  TaskTranscodeThumbnailStep,
  TaskTranscodeThumbnailStepOutput,
} from '@project/shared/jobs';
import type { StepJobData } from '../../queue/types/job.types';
import { FileType, FileSource } from '@project/shared';

/**
 * Processor for the THUMBNAIL step
 * Generates a thumbnail image and creates File record
 */
@Injectable()
export class ThumbnailStepProcessor extends BaseStepProcessor<
  TaskTranscodeThumbnailStep,
  TaskTranscodeThumbnailStepOutput
> {
  protected readonly logger = new Logger(ThumbnailStepProcessor.name);

  constructor(
    private readonly probeExecutor: FFmpegProbeExecutor,
    private readonly thumbnailExecutor: FFmpegThumbnailExecutor,
    private readonly storageService: StorageService,
    private readonly pocketbaseService: PocketBaseService
  ) {
    super();
  }

  async process(
    input: TaskTranscodeThumbnailStep,
    _job: Job<StepJobData>
  ): Promise<TaskTranscodeThumbnailStepOutput> {
    // Get upload for workspace reference first
    const upload = await this.pocketbaseService.getUpload(input.uploadId);
    if (!upload) {
      throw new Error(`Upload ${input.uploadId} not found`);
    }

    // Resolve file path
    const filePath = await FileResolver.resolveFilePath(
      input.uploadId,
      input.filePath,
      this.storageService,
      this.pocketbaseService
    );

    const mediaData = await this.pocketbaseService.findMediaByUpload(
      input.uploadId
    );
    if (!mediaData) {
      throw new Error(`Media not found for upload ${input.uploadId}`);
    }

    // Create enhanced config with source dimensions
    const enhancedConfig = {
      ...input.config,
      sourceWidth: mediaData.width,
      sourceHeight: mediaData.height,
    };

    // Generate output path using FileResolver
    const fileName = 'thumbnail.jpg';
    const thumbnailPath = FileResolver.resolveOutputFilePath(
      upload.WorkspaceRef,
      input.uploadId,
      fileName,
      this.storageService
    );

    // Generate thumbnail
    await this.thumbnailExecutor.execute(
      filePath,
      thumbnailPath,
      enhancedConfig,
      mediaData.duration
    );

    // Create File record
    const storageKey = `uploads/${upload.WorkspaceRef}/${input.uploadId}/${FileType.THUMBNAIL}/${fileName}`;

    const thumbnailFile = await this.pocketbaseService.uploadFile({
      localFilePath: thumbnailPath,
      fileName,
      fileType: FileType.THUMBNAIL,
      fileSource: FileSource.POCKETBASE,
      storageKey,
      workspaceRef: upload.WorkspaceRef,
      uploadRef: input.uploadId,
      mimeType: 'image/jpeg',
    });

    // Clean up local file if using S3
    await this.storageService.cleanup(thumbnailPath);

    // Update Media record
    const media = await this.pocketbaseService.findMediaByUpload(
      input.uploadId
    );
    if (media) {
      await this.pocketbaseService.updateMedia(media.id, {
        thumbnailFileRef: thumbnailFile.id,
      });
    }

    return { thumbnailPath, thumbnailFileId: thumbnailFile.id };
  }
}
