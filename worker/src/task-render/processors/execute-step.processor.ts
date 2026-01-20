import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { FFmpegComposeExecutor } from '../executors/ffmpeg/compose.executor';
import { FFmpegResolveClipsExecutor } from '../executors/ffmpeg/resolve-clips.executor';
import { StorageService } from '../../shared/services/storage.service';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { ProcessingProvider } from '@project/shared';
import * as path from 'path';
import { existsSync } from 'fs';
import {
  TaskRenderExecuteStep,
  TaskRenderExecuteStepOutput,
} from '@project/shared/jobs';
import type { StepJobData } from '../../queue/types/job.types';

/**
 * Processor for the EXECUTE step in rendering
 * Dispatches to FFmpeg (Google Cloud Transcoder support removed)
 * Fetches its own data (clipMediaMap) independently
 * Uses deterministic output path in ./data/renders/<taskId>/output.<format>
 */
@Injectable()
export class ExecuteRenderStepProcessor extends BaseStepProcessor<
  TaskRenderExecuteStep,
  TaskRenderExecuteStepOutput
> {
  protected readonly logger = new Logger(ExecuteRenderStepProcessor.name);

  constructor(
    private readonly ffmpegExecutor: FFmpegComposeExecutor,
    private readonly resolveClipsExecutor: FFmpegResolveClipsExecutor,
    private readonly storageService: StorageService,
    private readonly pocketBaseService: PocketBaseService
  ) {
    super();
  }

  async process(
    input: TaskRenderExecuteStep,
    job: Job<StepJobData>
  ): Promise<TaskRenderExecuteStepOutput> {
    const { timelineId, tracks, outputSettings } = input;
    const provider = job.data.provider || ProcessingProvider.FFMPEG;
    const taskId = job.data.taskId;

    this.logger.log(
      `Executing render for timeline ${timelineId} using ${provider}`
    );

    // Fetch clipMediaMap (to resolve media IDs and metadata)
    this.logger.debug(`Resolving media clips for timeline ${timelineId}`);
    const { clipMediaMap } = await this.resolveClipsExecutor.execute(
      timelineId,
      tracks
    );

    // Override with deterministic paths from the task inputs directory
    for (const [mediaId, clipMedia] of Object.entries(clipMediaMap)) {
      const extension = path.extname(clipMedia.filePath);
      const deterministicPath = this.storageService.getRenderInputPath(
        job.data.workspaceId,
        taskId,
        mediaId,
        extension
      );

      this.logger.debug(
        `Mapping media ${mediaId} to deterministic path: ${deterministicPath}`
      );

      if (!existsSync(deterministicPath)) {
        this.logger.warn(
          `Deterministic input file not found: ${deterministicPath}. Falling back to resolved path: ${clipMedia.filePath}`
        );
        // If the deterministic path doesn't exist, we might be in a retry or PREPARE might have been skipped.
        // We'll keep the original filePath as fallback, but log a warning.
      } else {
        clipMediaMap[mediaId].filePath = deterministicPath;
      }
    }

    this.logger.debug(
      `Resolved ${Object.keys(clipMediaMap).length} media files for composition`
    );

    if (provider === ProcessingProvider.GOOGLE_TRANSCODER) {
      this.logger.warn(
        'Google Cloud Transcoder is no longer supported for rendering. Falling back to FFmpeg.'
      );
    }

    // Create deterministic render output directory (ensure it exists)
    await this.storageService.createRenderDir(job.data.workspaceId, taskId);
    const outputPath = this.storageService.getRenderOutputPath(
      job.data.workspaceId,
      taskId,
      outputSettings.format
    );

    this.logger.log(`Render output path: ${outputPath}`);

    const startTime = Date.now();
    const executorResult = await this.ffmpegExecutor.execute(
      tracks,
      clipMediaMap,
      outputPath,
      outputSettings,
      (progress) => job.updateProgress(progress).catch(() => {})
    );
    const durationSec = (Date.now() - startTime) / 1000;

    // Log usage event
    await this.pocketBaseService.logUsageEvent({
      WorkspaceRef: job.data.workspaceId,
      type: 'FFMPEG_COMPUTE',
      subtype: 'RENDER',
      value: durationSec,
      unit: 'SECONDS',
      metadata: {
        timelineId,
        taskId,
        resolution: outputSettings.resolution,
        format: outputSettings.format,
      },
    });

    return {
      outputPath: executorResult.outputPath,
      storagePath: `renders/${job.data.workspaceId}/${taskId}/output.${outputSettings.format}`,
      isLocal: true,
      probeOutput: executorResult.probeOutput,
    };
  }
}
