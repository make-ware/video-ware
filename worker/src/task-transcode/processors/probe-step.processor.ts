import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as fs from 'fs/promises';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { FFmpegProbeExecutor } from '../executors';
import { StorageService } from '../../shared/services/storage.service';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { FileResolver } from '../utils/file-resolver';
import type {
  TaskTranscodeProbeStep,
  TaskTranscodeProbeStepOutput,
} from '@project/shared/jobs';
import type { StepJobData } from '../../queue/types/job.types';
import { MediaType, type MediaInput, type ProbeOutput } from '@project/shared';

/**
 * Processor for the PROBE step
 * Extracts metadata from the uploaded media file and creates Media record
 */
@Injectable()
export class ProbeStepProcessor extends BaseStepProcessor<
  TaskTranscodeProbeStep,
  TaskTranscodeProbeStepOutput
> {
  protected readonly logger = new Logger(ProbeStepProcessor.name);

  constructor(
    private readonly probeExecutor: FFmpegProbeExecutor,
    private readonly storageService: StorageService,
    private readonly pocketbaseService: PocketBaseService
  ) {
    super();
  }

  async process(
    input: TaskTranscodeProbeStep,
    _job: Job<StepJobData>
  ): Promise<TaskTranscodeProbeStepOutput> {
    // Resolve file path
    const filePath = await FileResolver.resolveFilePath(
      input.uploadId,
      input.filePath,
      this.storageService,
      this.pocketbaseService
    );

    // Execute probe
    const { probeOutput } = await this.probeExecutor.execute(filePath);

    // Get upload for workspace reference
    const upload = await this.pocketbaseService.getUpload(input.uploadId);
    if (!upload) {
      throw new Error(`Upload ${input.uploadId} not found`);
    }

    // Extract media date: prefer date from probe metadata, fallback to file stats
    let mediaDate: Date | undefined = probeOutput.mediaDate;
    if (!mediaDate) {
      try {
        const stats = await fs.stat(filePath);
        // Prefer birthtime (creation time) if available and valid, otherwise use mtime (modification time)
        // birthtime is more accurate for camera-recorded media, but may not be available on all filesystems
        // Check if birthtime is valid (not Unix epoch and different from mtime, or after year 2000)
        const year2000 = new Date('2000-01-01').getTime();
        const birthtimeValid =
          stats.birthtime.getTime() > year2000 &&
          stats.birthtime.getTime() !== stats.mtime.getTime();
        mediaDate = birthtimeValid ? stats.birthtime : stats.mtime;
        this.logger.debug(
          `Extracted mediaDate from file stats: ${mediaDate.toISOString()} (source: ${
            birthtimeValid ? 'birthtime' : 'mtime'
          })`
        );
      } catch (error) {
        this.logger.warn(
          `Failed to get file stats for date extraction: ${error}`
        );
      }
    } else {
      this.logger.debug(
        `Using mediaDate from probe metadata: ${mediaDate.toISOString()}`
      );
    }

    // Calculate aspect ratio
    const aspectRatio =
      probeOutput.width > 0 && probeOutput.height > 0
        ? probeOutput.width / probeOutput.height
        : undefined;

    // Determine media type
    const mediaType = this.determineMediaType(probeOutput);

    // Determine if audio is present
    const hasAudio =
      mediaType !== MediaType.IMAGE &&
      !!probeOutput.audio &&
      (probeOutput.audio.channels > 0 || !!probeOutput.audio.codec);

    // Default duration for images (e.g. 5 seconds)
    // This allows them to be placed on the timeline with a default length
    // We override duration even if it's small (e.g. 0.04s for 1 frame)
    if (mediaType === MediaType.IMAGE && probeOutput.duration < 5.0) {
      probeOutput.duration = 5.0;
    }

    // Update Media record
    const mediaData: Partial<MediaInput> = {
      mediaType,
      mediaDate: mediaDate?.toISOString(),
      duration: probeOutput.duration,
      width: probeOutput.width,
      height: probeOutput.height,
      aspectRatio,
      mediaData: probeOutput,
      hasAudio,
    };

    await this.pocketbaseService.updateMedia(input.mediaId, mediaData);

    return { probeOutput, mediaId: input.mediaId };
  }

  private determineMediaType(probeOutput: ProbeOutput): MediaType {
    // Check for image formats
    const imageCodecs = [
      'mjpeg',
      'png',
      'webp',
      'bmp',
      'tiff',
      'gif',
      'jpeg',
      'jpg',
    ];
    // Some images (like gif) might be detected as video with frames, so check codec first
    // If it has a video stream with an image codec, it's likely an image (or animated image)
    // Single frame videos are also treated as images for our purposes if duration is very low
    if (
      probeOutput.video &&
      (imageCodecs.includes(probeOutput.video.codec.toLowerCase()) ||
        probeOutput.duration < 0.1)
    ) {
      return MediaType.IMAGE;
    }

    if (probeOutput.video && probeOutput.width > 0 && probeOutput.height > 0) {
      return MediaType.VIDEO;
    }
    if (probeOutput.audio && !probeOutput.video) {
      return MediaType.AUDIO;
    }
    return MediaType.VIDEO;
  }
}
