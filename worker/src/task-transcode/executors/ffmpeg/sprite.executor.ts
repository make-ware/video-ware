import { Injectable, Logger } from '@nestjs/common';
import { evenTileHeight } from '@project/shared';
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

    // The geometry ffmpeg is about to be given IS the geometry of the sheet, so
    // it is also what the caller must record in the File's meta.
    const effective = this.resolveGeometry(config);

    await this.ffmpegService.generateSprite(
      filePath,
      outputPath,
      effective.fps,
      effective.cols,
      effective.rows,
      effective.tileWidth,
      effective.tileHeight,
      startTime
    );

    return {
      outputPath,
      ...effective,
      sheetWidth: effective.cols * effective.tileWidth,
      sheetHeight: effective.rows * effective.tileHeight,
    };
  }

  /**
   * Resolve the sprite geometry actually used.
   *
   * `tileHeight` is derived from the source's *display* aspect ratio whenever
   * the dimensions are known: `scale` forces exact dimensions, so obeying a
   * requested height that disagrees with the source would stretch every frame.
   * Display dimensions (not coded ones) are correct because ffmpeg autorotates
   * on decode — a portrait phone clip stored as 1920x1080 with a 90° matrix
   * reaches the filter graph as 1080x1920.
   */
  private resolveGeometry(config: SpriteConfig): {
    cols: number;
    rows: number;
    fps: number;
    tileWidth: number;
    tileHeight: number;
  } {
    const sourceWidth = config.sourceDisplayWidth ?? config.sourceWidth;
    const sourceHeight = config.sourceDisplayHeight ?? config.sourceHeight;

    const derived =
      sourceWidth && sourceHeight
        ? evenTileHeight(config.tileWidth, sourceWidth / sourceHeight)
        : 0;

    // Fall back to the requested height, then to 16:9, so `scale` always gets a
    // positive even height even for a source of unknown dimensions.
    const tileHeight =
      derived ||
      (config.tileHeight > 0
        ? config.tileHeight
        : evenTileHeight(config.tileWidth, 16 / 9));

    if (derived > 0 && derived !== config.tileHeight) {
      this.logger.debug(
        `Tile height ${config.tileHeight || 'unset'} -> ${derived} to match source display aspect ${sourceWidth}x${sourceHeight}`
      );
    }

    // Don't limit rows here - let FFmpeg generate as many rows as needed
    // The maxFrames limit is enforced by adjusting fps in the processor
    return {
      cols: config.cols,
      rows: config.rows,
      fps: config.fps,
      tileWidth: config.tileWidth,
      tileHeight,
    };
  }
}
