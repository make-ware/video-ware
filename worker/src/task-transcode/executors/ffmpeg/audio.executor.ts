import { Injectable, Logger } from '@nestjs/common';
import { FFmpegService } from '../../../shared/services/ffmpeg.service';
import * as path from 'path';
import * as fs from 'fs';

export interface AudioConfig {
  /** Audio format (mp3, aac, wav) */
  format?: 'mp3' | 'aac' | 'wav';
  /** Audio bitrate (e.g., '192k', '256k') */
  bitrate?: string;
  /** Number of audio channels (1 for mono, 2 for stereo) */
  channels?: number;
  /** Audio sample rate (e.g., 44100, 48000) */
  sampleRate?: number;
}

export interface AudioResult {
  /** Path to the extracted audio file */
  outputPath: string;
}

export type ProgressCallback = (progress: number) => void;

/**
 * FFmpeg implementation of the Audio Executor
 * Extracts audio-only tracks from video files
 */
@Injectable()
export class FFmpegAudioExecutor {
  private readonly logger = new Logger(FFmpegAudioExecutor.name);

  constructor(private readonly ffmpegService: FFmpegService) {}

  async execute(
    filePath: string,
    outputPath: string,
    config: AudioConfig = {},
    onProgress?: ProgressCallback
  ): Promise<AudioResult> {
    const format = config.format || 'mp3';
    const bitrate = config.bitrate || '192k';
    const channels = config.channels || 2; // Default to stereo
    const sampleRate = config.sampleRate || 48000;

    this.logger.debug(
      `Extracting audio: ${format} @ ${bitrate}, ${channels} channels, ${sampleRate}Hz`
    );

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    await fs.promises.mkdir(outputDir, { recursive: true });

    // Build FFmpeg command for audio extraction with custom settings
    const args = [
      '-y', // Overwrite output file
      '-i',
      filePath,
      '-vn', // No video
      '-ac',
      channels.toString(), // Audio channels
      '-ar',
      sampleRate.toString(), // Sample rate
    ];

    // Add codec and bitrate based on format
    if (format === 'mp3') {
      args.push('-codec:a', 'libmp3lame', '-b:a', bitrate);
    } else if (format === 'aac') {
      args.push('-codec:a', 'aac', '-b:a', bitrate);
    } else if (format === 'wav') {
      // WAV doesn't use bitrate, it's lossless
      args.push('-codec:a', 'pcm_s16le');
    }

    args.push(outputPath);

    // Execute with progress tracking if available
    if (onProgress) {
      await this.ffmpegService.executeWithProgress(args, onProgress);
    } else {
      await this.ffmpegService.executeWithProgress(args);
    }

    // Verify output file was created
    if (!fs.existsSync(outputPath)) {
      throw new Error('Audio file was not created');
    }

    this.logger.log(`Extracted audio: ${outputPath}`);

    return { outputPath };
  }
}
