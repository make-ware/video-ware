import { Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_WAVEFORM_HEIGHT,
  DEFAULT_WAVEFORM_PIXELS_PER_SECOND,
  type WaveformChunk,
  type WaveformConfig,
} from '@project/shared';
import { FFmpegService } from '../../../shared/services/ffmpeg.service';

/**
 * What one rendered waveform image actually contains.
 *
 * Reports the geometry handed to ffmpeg rather than the request: the chunk's
 * width follows its duration at the requested scale, so the last chunk of a
 * media is routinely narrower than `config.width`. Callers persist these onto
 * the File's `meta.waveformConfig`.
 */
export interface WaveformResult {
  outputPath: string;
  /** Pixel width of the written image */
  width: number;
  /** Pixel height of the written image */
  height: number;
  /** Absolute media time (seconds) of the first pixel */
  startTime: number;
  /** Seconds of audio drawn */
  duration: number;
  /** Pixels drawn per second of audio */
  pixelsPerSecond: number;
}

/**
 * FFmpeg implementation of the Waveform Executor
 * Renders one chunk of a media's audio track as a PNG waveform
 */
@Injectable()
export class FFmpegWaveformExecutor {
  private readonly logger = new Logger(FFmpegWaveformExecutor.name);

  constructor(private readonly ffmpegService: FFmpegService) {}

  async execute(
    filePath: string,
    outputPath: string,
    config: WaveformConfig,
    chunk: WaveformChunk
  ): Promise<WaveformResult> {
    const height =
      config.height && config.height > 0
        ? config.height
        : DEFAULT_WAVEFORM_HEIGHT;
    const pixelsPerSecond =
      config.pixelsPerSecond && config.pixelsPerSecond > 0
        ? config.pixelsPerSecond
        : DEFAULT_WAVEFORM_PIXELS_PER_SECOND;

    this.logger.debug(
      `Rendering waveform chunk ${chunk.index}: ${chunk.width}x${height} ` +
        `covering ${chunk.duration.toFixed(2)}s from ${chunk.startTime}s`
    );

    await this.ffmpegService.generateWaveform(filePath, outputPath, {
      width: chunk.width,
      height,
      startTime: chunk.startTime,
      duration: chunk.duration,
      color: config.color,
      mono: config.mono,
    });

    return {
      outputPath,
      width: chunk.width,
      height,
      startTime: chunk.startTime,
      duration: chunk.duration,
      pixelsPerSecond,
    };
  }
}
