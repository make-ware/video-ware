import { Injectable, Logger } from '@nestjs/common';
import { FFmpegService } from '../../../shared/services/ffmpeg.service';
import type {
  ITranscodeExecutor,
  TranscodeConfig,
  TranscodeResult,
  ProgressCallback,
} from '../interfaces';

/**
 * FFmpeg implementation of the Transcode Executor
 * Transcodes video files using FFmpeg
 */
@Injectable()
export class FFmpegTranscodeExecutor implements ITranscodeExecutor {
  private readonly logger = new Logger(FFmpegTranscodeExecutor.name);

  constructor(private readonly ffmpegService: FFmpegService) {}

  async execute(
    filePath: string,
    outputPath: string,
    config: TranscodeConfig,
    onProgress?: ProgressCallback
  ): Promise<TranscodeResult> {
    this.logger.debug(`Transcoding to ${config.resolution}: ${outputPath}`);

    const { width, height } = this.resolveResolution(config);
    const videoCodec = this.resolveCodec(config.codec);
    const bitrate = this.resolveBitrate(config.bitrate);

    await this.ffmpegService.transcode(
      filePath,
      outputPath,
      {
        width,
        height,
        videoCodec,
        videoBitrate: bitrate,
        audioBitrate: '128k',
      },
      onProgress
    );

    return { outputPath };
  }

  private resolveResolution(config: TranscodeConfig): {
    width: number;
    height: number;
  } {
    const resolutions: Record<string, { width: number; height: number }> = {
      '720p': { width: 1280, height: 720 },
      '1080p': { width: 1920, height: 1080 },
    };

    // Use display dimensions (rotation-adjusted) for aspect ratio calculation
    // Fall back to source dimensions if display dimensions not provided
    const displayWidth = config.sourceDisplayWidth ?? config.sourceWidth;
    const displayHeight = config.sourceDisplayHeight ?? config.sourceHeight;

    if (config.resolution === 'original') {
      // For original resolution, return display dimensions (post-rotation)
      return { width: displayWidth, height: displayHeight };
    }

    // Get target resolution
    const targetRes = resolutions[config.resolution] || resolutions['720p'];

    // Calculate source aspect ratio using display dimensions
    const sourceAspectRatio = displayWidth / displayHeight;

    // Maintain aspect ratio by adjusting dimensions
    // Scale to fit within target resolution while preserving aspect ratio
    let width = targetRes.width;
    let height = Math.round(width / sourceAspectRatio);

    // If height exceeds target, scale by height instead
    if (height > targetRes.height) {
      height = targetRes.height;
      width = Math.round(height * sourceAspectRatio);
    }

    // Ensure dimensions are even (required by most video codecs)
    width = Math.round(width / 2) * 2;
    height = Math.round(height / 2) * 2;

    this.logger.debug(
      `Resolved resolution: ${displayWidth}x${displayHeight} (rotation: ${config.rotation ?? 0}°) -> ${width}x${height}`
    );

    return { width, height };
  }

  private resolveCodec(codec: string): string {
    const codecs: Record<string, string> = {
      h264: 'libx264',
      h265: 'libx265',
      vp9: 'libvpx-vp9',
    };
    return codecs[codec] || 'libx264';
  }

  private resolveBitrate(bitrate?: number): string {
    if (!bitrate) return '6M';
    return `${Math.round(bitrate / 1000000)}M`;
  }
}
