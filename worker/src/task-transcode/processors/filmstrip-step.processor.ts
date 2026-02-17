import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { FFmpegSpriteExecutor } from '../executors';
import { StorageService } from '../../shared/services/storage.service';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { FileResolver } from '../utils/file-resolver';
import type {
  TaskTranscodeFilmstripStep,
  TaskTranscodeFilmstripStepOutput,
} from '@project/shared/jobs';
import type { StepJobData } from '../../queue/types/job.types';
import { FileType, FileSource, MediaType } from '@project/shared';

/**
 * Processor for the FILMSTRIP step
 * Generates a filmstrip (1x100) and creates File record
 */
@Injectable()
export class FilmstripStepProcessor extends BaseStepProcessor<
  TaskTranscodeFilmstripStep,
  TaskTranscodeFilmstripStepOutput
> {
  protected readonly logger = new Logger(FilmstripStepProcessor.name);

  constructor(
    private readonly spriteExecutor: FFmpegSpriteExecutor,
    private readonly storageService: StorageService,
    private readonly pocketbaseService: PocketBaseService
  ) {
    super();
  }

  async process(
    input: TaskTranscodeFilmstripStep,
    _job: Job<StepJobData>
  ): Promise<TaskTranscodeFilmstripStepOutput> {
    // Get upload for workspace reference
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

    // Skip processing for images
    if (mediaData.mediaType === MediaType.IMAGE) {
      this.logger.log(
        `Skipping filmstrip generation for image media: ${mediaData.id}`
      );
      // Return empty result
      return {
        filmstripPath: '',
        filmstripFileId: '',
        allFilmstripFileIds: [],
      };
    }

    // Resolve file path
    const filePath = await FileResolver.resolveFilePath(
      input.uploadId,
      input.filePath,
      this.storageService,
      this.pocketbaseService
    );

    const duration = mediaData.duration;
    const segmentDuration = 100; // 100 seconds per segment
    const segmentCount = Math.ceil(duration / segmentDuration);

    const cols = 100;
    const rows = 1;
    const fps = 1; // 1 fps = 1s interval
    const tileWidth = input.config.tileWidth || 160;

    // Calculate tile height maintaining aspect ratio if not provided
    let tileHeight = input.config.tileHeight;
    if (!tileHeight) {
      const aspectRatio = mediaData.aspectRatio;
      tileHeight = Math.round(tileWidth / aspectRatio);
      // Ensure even number for FFmpeg
      tileHeight = Math.round(tileHeight / 2) * 2;
    }

    const filmstripFileIds: string[] = [];
    let firstFilmstripPath = '';

    for (let i = 0; i < segmentCount; i++) {
      const startTime = i * segmentDuration;
      this.logger.log(
        `Generating filmstrip segment ${i + 1}/${segmentCount}: ${cols}x${rows} at ${fps} fps starting at ${startTime}s`
      );

      // Create enhanced config
      const enhancedConfig = {
        ...input.config,
        sourceWidth: mediaData.width,
        sourceHeight: mediaData.height,
        fps,
        cols,
        rows,
        tileWidth,
        tileHeight,
      };

      // Generate output path using FileResolver
      const fileName = `filmstrip_${i}.jpg`;
      const filmstripPath = FileResolver.resolveOutputFilePath(
        upload.WorkspaceRef,
        input.uploadId,
        fileName,
        this.storageService
      );
      if (i === 0) firstFilmstripPath = filmstripPath;

      await this.spriteExecutor.execute(
        filePath,
        filmstripPath,
        enhancedConfig,
        startTime
      );

      // Create File record
      const storageKey = `uploads/${upload.WorkspaceRef}/${input.uploadId}/${FileType.FILMSTRIP}/${fileName}`;

      const filmstripFile = await this.pocketbaseService.uploadFile({
        localFilePath: filmstripPath,
        fileName,
        fileType: FileType.FILMSTRIP,
        fileSource: FileSource.POCKETBASE,
        storageKey,
        workspaceRef: upload.WorkspaceRef,
        uploadRef: input.uploadId,
        mimeType: 'image/jpeg',
        meta: {
          mimeType: 'image/jpeg',
          filmstripConfig: {
            cols: enhancedConfig.cols,
            rows: enhancedConfig.rows,
            tileWidth: enhancedConfig.tileWidth,
            tileHeight: enhancedConfig.tileHeight,
          },
        },
      });

      // Clean up local file if using S3
      await this.storageService.cleanup(filmstripPath);

      filmstripFileIds.push(filmstripFile.id);
    }

    // Update Media record with the first filmstrip as primary
    const media = await this.pocketbaseService.findMediaByUpload(
      input.uploadId
    );
    if (media && filmstripFileIds.length > 0) {
      await this.pocketbaseService.updateMedia(media.id, {
        filmstripFileRefs: filmstripFileIds,
      });
    }

    return {
      filmstripPath: firstFilmstripPath,
      filmstripFileId: filmstripFileIds[0],
      allFilmstripFileIds: filmstripFileIds,
    };
  }
}
