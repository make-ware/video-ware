import { Injectable, Logger } from '@nestjs/common';
import { FFmpegService } from '../../../shared/services/ffmpeg.service';
import type {
  ISpriteExecutor,
  SpriteConfig,
  SpriteResult,
} from '../interfaces';

/**
 * FFmpeg implementation of the Sprite Executor
 * Generates sprite sheets using FFmpeg
 */
@Injectable()
export class FFmpegSpriteExecutor implements ISpriteExecutor {
  private readonly logger = new Logger(FFmpegSpriteExecutor.name);

  constructor(private readonly ffmpegService: FFmpegService) {}

  async execute(
    filePath: string,
    outputPath: string,
    config: SpriteConfig,
    startTime: number = 0
  ): Promise<SpriteResult> {
    this.logger.debug(
      `Generating sprite sheet: ${outputPath} starting at ${startTime}s`
    );

    // Calculate tile height maintaining aspect ratio
    const { tileHeight, rows, fps } = this.calculateSpriteParams(config);

    await this.ffmpegService.generateSprite(
      filePath,
      outputPath,
      fps,
      config.cols,
      rows,
      config.tileWidth,
      tileHeight,
      startTime
    );

    return { outputPath };
  }

  private calculateSpriteParams(config: SpriteConfig): {
    tileHeight: number;
    rows: number;
    fps: number;
  } {
    // Calculate tile height maintaining aspect ratio
    let tileHeight = config.tileHeight;
    if (config.sourceWidth && config.sourceHeight) {
      const sourceAspectRatio = config.sourceWidth / config.sourceHeight;
      tileHeight = Math.round(config.tileWidth / sourceAspectRatio);
      // Ensure even number
      tileHeight = Math.round(tileHeight / 2) * 2;
    }

    // Don't limit rows here - let FFmpeg generate as many rows as needed
    // The maxFrames limit is enforced by adjusting fps in the processor
    const rows = config.rows;
    const fps = config.fps;

    return { tileHeight, rows, fps };
  }
}
