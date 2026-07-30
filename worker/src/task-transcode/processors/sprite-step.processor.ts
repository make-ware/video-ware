import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { FFmpegProbeExecutor, FFmpegSpriteExecutor } from '../executors';
import { StorageService } from '../../shared/services/storage.service';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { FileResolver } from '../utils/file-resolver';
import type {
  TaskTranscodeSpriteStep,
  TaskTranscodeSpriteStepOutput,
} from '@project/shared/jobs';
import type { StepJobData } from '../../queue/types/job.types';
import {
  FileType,
  FileSource,
  MediaType,
  mediaDisplayDimensions,
} from '@project/shared';

/**
 * Processor for the SPRITE step
 * Generates a sprite sheet and creates File record
 */
@Injectable()
export class SpriteStepProcessor extends BaseStepProcessor<
  TaskTranscodeSpriteStep,
  TaskTranscodeSpriteStepOutput
> {
  protected readonly logger = new Logger(SpriteStepProcessor.name);

  constructor(
    private readonly probeExecutor: FFmpegProbeExecutor,
    private readonly spriteExecutor: FFmpegSpriteExecutor,
    private readonly storageService: StorageService,
    private readonly pocketbaseService: PocketBaseService
  ) {
    super();
  }

  async process(
    input: TaskTranscodeSpriteStep,
    _job: Job<StepJobData>
  ): Promise<TaskTranscodeSpriteStepOutput> {
    // Get upload for workspace reference first
    const upload = await this.pocketbaseService.getUpload(input.uploadId);
    if (!upload) {
      throw new Error(`Upload ${input.uploadId} not found`);
    }

    const mediaData = await this.pocketbaseService.findMediaByUpload(
      input.uploadId
    );
    if (!mediaData) {
      throw new Error(`Media not found for upload ${input.uploadId}`);
    }

    // Skip processing for audio (images get a single-tile sprite below)
    if (mediaData.mediaType === MediaType.AUDIO) {
      this.logger.log(
        `Skipping sprite generation for audio media: ${mediaData.id}`
      );
      // Return empty result
      return { spritePath: '', spriteFileId: '' };
    }

    // Resolve file path
    const filePath = await FileResolver.resolveFilePath(
      input.uploadId,
      input.filePath,
      this.storageService,
      this.pocketbaseService
    );

    // Use probe output from input
    const duration = mediaData.duration;
    const isImage = mediaData.mediaType === MediaType.IMAGE;

    // Images get a single tile; videos get a 10x10 spritesheet (100 frames max)
    const cols = isImage ? 1 : 10;
    const rows = isImage ? 1 : 10;
    const fps = isImage ? 0 : Math.min(1, 100 / duration);

    this.logger.log(
      `Generating sprite sheet: ${cols}x${rows} at ${fps.toFixed(4)} fps for ${duration}s ${mediaData.mediaType}`
    );

    // Create enhanced config with source dimensions and calculated grid.
    // Display dimensions carry the rotation ffmpeg applies on decode, so they
    // are what the executor must shape tiles to.
    const display = mediaDisplayDimensions(mediaData);
    const enhancedConfig = {
      ...input.config,
      sourceWidth: mediaData.width,
      sourceHeight: mediaData.height,
      sourceDisplayWidth: display.width,
      sourceDisplayHeight: display.height,
      fps,
      cols,
      rows,
    };

    // Generate output path using FileResolver
    const fileName = 'sprite.jpg';
    const spritePath = FileResolver.resolveOutputFilePath(
      upload.WorkspaceRef,
      input.uploadId,
      fileName,
      this.storageService
    );

    try {
      // Generate sprite. The result reports the geometry the sheet was really
      // built with (tile height follows the source display aspect), which is
      // what goes into meta — the requested config would be a lie for any
      // media that isn't the aspect the caller guessed.
      const sprite = await this.spriteExecutor.execute(
        filePath,
        spritePath,
        enhancedConfig
      );

      // Create File record with sprite configuration in meta
      const storageKey = this.storageService.transcodeStorageKey(
        upload.WorkspaceRef,
        input.uploadId,
        FileType.SPRITE,
        fileName
      );

      // Fetch the Media first so we can link the File back to it (enables
      // cascade delete of the sprite when the Media is removed).
      const media = await this.pocketbaseService.findMediaByUpload(
        input.uploadId
      );

      const spriteFile = await this.pocketbaseService.uploadFile({
        localFilePath: spritePath,
        fileName,
        fileType: FileType.SPRITE,
        fileSource: FileSource.POCKETBASE,
        storageKey,
        workspaceRef: upload.WorkspaceRef,
        uploadRef: input.uploadId,
        mediaRef: media?.id,
        mimeType: 'image/jpeg',
        meta: {
          mimeType: 'image/jpeg',
          spriteConfig: {
            cols: sprite.cols,
            rows: sprite.rows,
            fps: sprite.fps,
            tileWidth: sprite.tileWidth,
            tileHeight: sprite.tileHeight,
          },
          // Dimensions of the sheet itself, so a consumer can size/validate it
          // without decoding the image.
          width: sprite.sheetWidth,
          height: sprite.sheetHeight,
        },
      });

      // Update Media record
      if (media) {
        await this.pocketbaseService.updateMedia(media.id, {
          spriteFileRef: spriteFile.id,
        });
      }

      return { spritePath, spriteFileId: spriteFile.id };
    } finally {
      // Clean up local output file if using S3 (no-op in local mode), on
      // both success and failure so a stateless pod never accumulates disk.
      await this.storageService.cleanup(spritePath);
    }
  }
}
