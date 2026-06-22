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
import { FileType, FileSource, MediaType } from '@project/shared';

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

    // Skip processing for audio
    if (mediaData.mediaType === MediaType.AUDIO) {
      this.logger.log(
        `Skipping thumbnail generation for audio media: ${mediaData.id}`
      );
      // Return empty result
      return { thumbnailPath: '', thumbnailFileId: '' };
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

    try {
      // Generate thumbnail
      const effectiveDuration =
        mediaData.mediaType === MediaType.IMAGE ? 0 : mediaData.duration;
      await this.thumbnailExecutor.execute(
        filePath,
        thumbnailPath,
        enhancedConfig,
        effectiveDuration
      );

      // Create File record
      const storageKey = this.storageService.transcodeStorageKey(
        upload.WorkspaceRef,
        input.uploadId,
        FileType.THUMBNAIL,
        fileName
      );

      const thumbnailFile = await this.pocketbaseService.uploadFile({
        localFilePath: thumbnailPath,
        fileName,
        fileType: FileType.THUMBNAIL,
        fileSource: FileSource.POCKETBASE,
        storageKey,
        workspaceRef: upload.WorkspaceRef,
        uploadRef: input.uploadId,
        // Link to Media so the record is removed when the Media is deleted.
        mediaRef: mediaData.id,
        mimeType: 'image/jpeg',
      });

      // Update Media record
      await this.pocketbaseService.updateMedia(mediaData.id, {
        thumbnailFileRef: thumbnailFile.id,
      });

      return { thumbnailPath, thumbnailFileId: thumbnailFile.id };
    } finally {
      // Clean up local output file if using S3 (no-op in local mode), on
      // both success and failure so a stateless pod never accumulates disk.
      await this.storageService.cleanup(thumbnailPath);
    }
  }
}
