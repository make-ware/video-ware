import { Injectable, Logger } from '@nestjs/common';
import { FFmpegService } from '../../../shared/services/ffmpeg.service';
import type {
  IThumbnailExecutor,
  ThumbnailConfig,
  ThumbnailResult,
} from '../interfaces';

/**
 * FFmpeg implementation of the Thumbnail Executor
 * Generates thumbnail images using FFmpeg
 */
@Injectable()
export class FFmpegThumbnailExecutor implements IThumbnailExecutor {
  private readonly logger = new Logger(FFmpegThumbnailExecutor.name);

  constructor(private readonly ffmpegService: FFmpegService) {}

  async execute(
    filePath: string,
    outputPath: string,
    config: ThumbnailConfig,
    duration: number
  ): Promise<ThumbnailResult> {
    const timestamp = this.calculateTimestamp(config.timestamp, duration);

    this.logger.debug(`Generating thumbnail at ${timestamp}s: ${outputPath}`);

    // Calculate dimensions maintaining aspect ratio. Display dimensions, not
    // coded ones: ffmpeg autorotates on decode, so a portrait clip stored as
    // 1920x1080 with a 90° matrix must be fitted as 1080x1920 or the frame is
    // stretched into the landscape box.
    const { width, height } = this.calculateDimensions(
      config.width,
      config.height,
      config.sourceDisplayWidth ?? config.sourceWidth,
      config.sourceDisplayHeight ?? config.sourceHeight
    );

    await this.ffmpegService.generateThumbnail(
      filePath,
      outputPath,
      timestamp,
      width,
      height
    );

    // Report what was written, not what was asked for — the fitted box is
    // usually smaller than the requested one on one axis.
    return { outputPath, width, height, timestamp };
  }

  private calculateDimensions(
    targetWidth: number,
    targetHeight: number,
    sourceWidth: number,
    sourceHeight: number
  ): { width: number; height: number } {
    // If source dimensions not provided, use target dimensions
    if (!sourceWidth || !sourceHeight) {
      return { width: targetWidth, height: targetHeight };
    }

    const sourceAspectRatio = sourceWidth / sourceHeight;

    // Scale to fit within target dimensions while preserving aspect ratio
    let width = targetWidth;
    let height = Math.round(width / sourceAspectRatio);

    // If height exceeds target, scale by height instead
    if (height > targetHeight) {
      height = targetHeight;
      width = Math.round(height * sourceAspectRatio);
    }

    // Ensure dimensions are even
    width = Math.round(width / 2) * 2;
    height = Math.round(height / 2) * 2;

    return { width, height };
  }

  private calculateTimestamp(
    timestamp: number | 'midpoint',
    duration: number
  ): number {
    let calculated = timestamp === 'midpoint' ? duration / 2 : timestamp;
    calculated = Math.max(0, Math.min(calculated, duration - 1));
    return calculated;
  }
}
