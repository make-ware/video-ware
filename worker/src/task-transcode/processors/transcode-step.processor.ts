import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import {
  FFmpegProbeExecutor,
  FFmpegTranscodeExecutor,
  GoogleTranscodeExecutor,
} from '../executors';
import type {
  ITranscodeExecutor,
  TranscodeConfig as ExecutorTranscodeConfig,
} from '../executors/interfaces';
import { StorageService } from '../../shared/services/storage.service';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { FileResolver } from '../utils/file-resolver';
import type {
  TaskTranscodeTranscodeStep,
  TaskTranscodeTranscodeStepOutput,
} from '@project/shared/jobs';
import type { StepJobData } from '../../queue/types/job.types';
import {
  ProcessingProvider,
  FileType,
  FileSource,
  MediaType,
} from '@project/shared';

/**
 * Processor for the TRANSCODE step
 * Creates a proxy video using the configured provider (FFmpeg or Google Cloud)
 */
@Injectable()
export class TranscodeStepProcessor extends BaseStepProcessor<
  TaskTranscodeTranscodeStep,
  TaskTranscodeTranscodeStepOutput
> {
  protected readonly logger = new Logger(TranscodeStepProcessor.name);

  constructor(
    private readonly probeExecutor: FFmpegProbeExecutor,
    private readonly ffmpegTranscodeExecutor: FFmpegTranscodeExecutor,
    private readonly googleTranscodeExecutor: GoogleTranscodeExecutor,
    private readonly storageService: StorageService,
    private readonly pocketbaseService: PocketBaseService
  ) {
    super();
  }

  async process(
    input: TaskTranscodeTranscodeStep,
    _job: Job<StepJobData>
  ): Promise<TaskTranscodeTranscodeStepOutput> {
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

    // Skip processing for images and audio
    if (
      mediaData.mediaType === MediaType.IMAGE ||
      mediaData.mediaType === MediaType.AUDIO
    ) {
      this.logger.log(
        `Skipping transcoding for ${mediaData.mediaType} media: ${mediaData.id}`
      );
      // Return empty result
      return { proxyPath: '', proxyFileId: '' };
    }

    // Resolve file path
    const filePath = await FileResolver.resolveFilePath(
      input.uploadId,
      input.filePath,
      this.storageService,
      this.pocketbaseService
    );

    // Probe for dimensions (independent of other steps)
    const { probeOutput } = await this.probeExecutor.execute(filePath);

    // Select executor based on provider
    const executor = this.selectExecutor(input.provider);

    // Build executor config
    const executorConfig: ExecutorTranscodeConfig = {
      resolution: input.config.resolution as '720p' | '1080p' | 'original',
      codec: input.config.codec as 'h264' | 'h265' | 'vp9',
      bitrate: input.config.bitrate,
      sourceWidth: probeOutput.width,
      sourceHeight: probeOutput.height,
      sourceDisplayWidth: probeOutput.displayWidth,
      sourceDisplayHeight: probeOutput.displayHeight,
      rotation: probeOutput.rotation,
    };

    // Generate output path using FileResolver
    const fileName = 'proxy.mp4';
    const proxyPath = FileResolver.resolveOutputFilePath(
      upload.WorkspaceRef,
      input.uploadId,
      fileName,
      this.storageService
    );

    // Execute transcode
    const startTime = Date.now();
    await executor.execute(filePath, proxyPath, executorConfig);
    const durationSec = (Date.now() - startTime) / 1000;

    // Log usage event
    await this.pocketbaseService.logUsageEvent({
      WorkspaceRef: upload.WorkspaceRef,
      type:
        input.provider === ProcessingProvider.GOOGLE_TRANSCODER
          ? 'GOOGLE_TRANSCODER'
          : 'FFMPEG_COMPUTE',
      subtype: 'TRANSCODE',
      value: durationSec,
      unit: 'SECONDS',
      metadata: {
        uploadId: input.uploadId,
        resolution: input.config.resolution,
        codec: input.config.codec,
      },
    });

    // Create File record
    const storageKey = `uploads/${upload.WorkspaceRef}/${input.uploadId}/${FileType.PROXY}/${fileName}`;

    const proxyFile = await this.pocketbaseService.uploadFile({
      localFilePath: proxyPath,
      fileName,
      fileType: FileType.PROXY,
      fileSource: FileSource.POCKETBASE,
      storageKey,
      workspaceRef: upload.WorkspaceRef,
      uploadRef: input.uploadId,
      mimeType: 'video/mp4',
    });

    // Clean up local file if using S3
    await this.storageService.cleanup(proxyPath);

    // Update Media record
    const media = await this.pocketbaseService.findMediaByUpload(
      input.uploadId
    );
    if (media) {
      await this.pocketbaseService.updateMedia(media.id, {
        proxyFileRef: proxyFile.id,
      });
    }

    return { proxyPath, proxyFileId: proxyFile.id };
  }

  private selectExecutor(provider: ProcessingProvider): ITranscodeExecutor {
    switch (provider) {
      case ProcessingProvider.GOOGLE_TRANSCODER:
        return this.googleTranscodeExecutor;
      case ProcessingProvider.FFMPEG:
      default:
        return this.ffmpegTranscodeExecutor;
    }
  }
}
