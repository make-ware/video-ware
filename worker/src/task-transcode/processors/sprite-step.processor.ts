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
import { FileType, FileSource } from '@project/shared';

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

    // Use probe output from input
    const duration = mediaData.duration;

    // The user wants a 10x10 spritesheet (100 frames) covering the whole video
    // Variable fps (1 or less)
    const cols = 10;
    const rows = 10;

    // Calculate fps to get 100 frames over the duration, capped at 1 fps
    const fps = Math.min(1, 100 / duration);

    this.logger.log(
      `Generating sprite sheet: ${cols}x${rows} at ${fps.toFixed(4)} fps for ${duration}s video`
    );

    // Create enhanced config with source dimensions and calculated grid
    const enhancedConfig = {
      ...input.config,
      sourceWidth: mediaData.width,
      sourceHeight: mediaData.height,
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

    // Generate sprite
    await this.spriteExecutor.execute(filePath, spritePath, enhancedConfig);

    // Create File record with sprite configuration in meta
    const storageKey = `uploads/${upload.WorkspaceRef}/${input.uploadId}/${FileType.SPRITE}/${fileName}`;

    const spriteFile = await this.pocketbaseService.uploadFile({
      localFilePath: spritePath,
      fileName,
      fileType: FileType.SPRITE,
      fileSource: FileSource.POCKETBASE,
      storageKey,
      workspaceRef: upload.WorkspaceRef,
      uploadRef: input.uploadId,
      mimeType: 'image/jpeg',
      meta: {
        mimeType: 'image/jpeg',
        spriteConfig: {
          cols: enhancedConfig.cols,
          rows: enhancedConfig.rows,
          fps: enhancedConfig.fps,
          tileWidth: enhancedConfig.tileWidth,
          tileHeight: enhancedConfig.tileHeight,
        },
      },
    });

    // Clean up local file if using S3
    await this.storageService.cleanup(spritePath);

    // Update Media record
    const media = await this.pocketbaseService.findMediaByUpload(
      input.uploadId
    );
    if (media) {
      await this.pocketbaseService.updateMedia(media.id, {
        spriteFileRef: spriteFile.id,
      });
    }

    return { spritePath, spriteFileId: spriteFile.id };
  }
}
