import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { FFmpegResolveClipsExecutor } from '../executors/ffmpeg/resolve-clips.executor';
import { GoogleCloudService } from '../../shared/services/google-cloud.service';
import { ProcessingProvider } from '@project/shared';
import { StorageService } from '../../shared/services/storage.service';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import {
  TaskRenderPrepareStep,
  TaskRenderPrepareStepOutput,
} from '@project/shared/jobs';
import type { StepJobData } from '../../queue/types/job.types';
import type { Media } from '@project/shared';

/**
 * Processor for the PREPARE step in rendering
 * Resolves media file paths and prepares them for the selected provider
 */
@Injectable()
export class PrepareRenderStepProcessor extends BaseStepProcessor<
  TaskRenderPrepareStep,
  TaskRenderPrepareStepOutput
> {
  protected readonly logger = new Logger(PrepareRenderStepProcessor.name);

  constructor(
    private readonly resolveClipsExecutor: FFmpegResolveClipsExecutor,
    private readonly googleCloudService: GoogleCloudService,
    private readonly storageService: StorageService
  ) {
    super();
  }

  async process(
    input: TaskRenderPrepareStep,
    job: Job<StepJobData>
  ): Promise<TaskRenderPrepareStepOutput> {
    const { timelineId, tracks } = input;
    const taskId = job.data.taskId;

    this.logger.log(
      `Preparing original media for timeline ${timelineId} render (Task: ${taskId})`
    );

    // 1. Resolve media clips to local paths (standard logic)
    const { clipMediaMap } = await this.resolveClipsExecutor.execute(
      timelineId,
      tracks
    );

    // 2. Ensure deterministic inputs directory exists
    const inputsDir = this.storageService.getRenderInputsDir(
      job.data.workspaceId,
      taskId
    );
    await fs.mkdir(inputsDir, { recursive: true });

    // 3. Link or copy files to the inputs directory
    for (const [mediaId, clipMedia] of Object.entries(clipMediaMap)) {
      const extension = path.extname(clipMedia.filePath);
      const targetPath = this.storageService.getRenderInputPath(
        job.data.workspaceId,
        taskId,
        mediaId,
        extension
      );

      if (!existsSync(targetPath)) {
        this.logger.debug(`Linking original media ${mediaId} to ${targetPath}`);
        // Use symlink to avoid copying large files
        // Note: In some environments (like Windows or some Docker setups), symlinks might require special permissions
        // or hard links might be preferred. For now, using symlink.
        try {
          await fs.symlink(clipMedia.filePath, targetPath);
        } catch (symlinkError) {
          this.logger.warn(
            `Failed to symlink, falling back to copy: ${symlinkError instanceof Error ? symlinkError.message : String(symlinkError)}`
          );
          await fs.copyFile(clipMedia.filePath, targetPath);
        }
      }

      // Update the path in the map to the deterministic one
      clipMediaMap[mediaId].filePath = targetPath;
    }

    // 4. If using Google Cloud Transcoder, ensure all files are in GCS
    const provider = job.data.provider || ProcessingProvider.FFMPEG;

    if (provider === ProcessingProvider.GOOGLE_TRANSCODER) {
      this.logger.log(
        `Ensuring media files are available in GCS for Google Cloud Transcoder`
      );

      for (const [mediaId, clipMedia] of Object.entries(clipMediaMap)) {
        if (clipMedia.filePath.startsWith('gs://')) {
          continue; // Already in GCS
        }

        this.logger.log(`Uploading media ${mediaId} to GCS temp bucket`);
        const gcsUri = await this.googleCloudService.uploadToGcsTempBucket(
          clipMedia.filePath,
          job.data.workspaceId,
          mediaId
        );

        // Update the map with GCS URI
        clipMediaMap[mediaId].filePath = gcsUri;
      }
    }

    // Return the map (now with deterministic paths)
    // Even though we want to avoid passing it, keeping it for backward compatibility
    // in case EXECUTE hasn't been updated yet or needs it for some metadata.
    return { clipMediaMap };
  }
}
