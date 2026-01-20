import { Injectable, Logger } from '@nestjs/common';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

export interface ProbeResult {
  format: {
    duration: number;
    size: number;
    bit_rate: number;
    format_name: string;
    format_long_name: string;
    tags?: Record<string, string>;
  };
  streams: Array<{
    index: number;
    codec_name: string;
    codec_type: 'video' | 'audio' | 'subtitle' | 'data';
    width?: number;
    height?: number;
    duration?: number;
    bit_rate?: number;
    sample_rate?: number;
    channels?: number;
    r_frame_rate?: string;
    avg_frame_rate?: string;
    profile?: string;
    display_aspect_ratio?: string;
    pix_fmt?: string;
    level?: number;
    color_space?: string;
    tags?: Record<string, string>;
  }>;
}

export interface TranscodeOptions {
  width?: number;
  height?: number;
  videoBitrate?: string;
  audioBitrate?: string;
  videoCodec?: string;
  audioCodec?: string;
  format?: string;
  preset?: string;
  crf?: number;
  maxrate?: string;
  bufsize?: string;
  profile?: string;
  level?: string;
  pixelFormat?: string;
  frameRate?: number;
  keyframeInterval?: number;
  audioSampleRate?: number;
  audioChannels?: number;
}

@Injectable()
export class FFmpegService {
  private readonly logger = new Logger(FFmpegService.name);

  /**
   * Probe media file to get metadata
   */
  async probe(filePath: string): Promise<ProbeResult> {
    try {
      // Verify file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const command = `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`;
      this.logger.debug(`Probing file: ${command}`);

      const { stdout, stderr } = await execAsync(command);

      if (stderr) {
        this.logger.warn(`FFprobe stderr: ${stderr}`);
      }

      const result = JSON.parse(stdout);

      // Validate result structure
      if (!result.format || !result.streams) {
        throw new Error('Invalid probe result: missing format or streams');
      }

      this.logger.log(
        `Probed ${filePath}: ${result.format.duration}s, ${result.streams.length} streams`
      );
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to probe ${filePath}: ${errorMessage}`);
      throw new Error(`FFprobe failed: ${errorMessage}`);
    }
  }

  /**
   * Generate thumbnail from video at specific timestamp
   */
  async generateThumbnail(
    inputPath: string,
    outputPath: string,
    timestamp: number = 1,
    width: number = 320,
    height: number = 240
  ): Promise<void> {
    try {
      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      await fs.promises.mkdir(outputDir, { recursive: true });

      const command = [
        'ffmpeg',
        '-y', // Overwrite output file
        `-ss ${timestamp}`, // Seek to timestamp
        `-i "${inputPath}"`, // Input file
        '-vframes 1', // Extract single frame
        `-vf scale=${width}:${height}`, // Scale to desired size
        '-q:v 2', // High quality
        '-update 1', // Update the same file (required for single image output)
        `"${outputPath}"`, // Output file
      ].join(' ');

      this.logger.debug(`Generating thumbnail: ${command}`);

      const { stderr } = await execAsync(command);

      if (stderr) {
        this.logger.debug(`FFmpeg stderr: ${stderr}`);
      }

      // Verify output file was created
      if (!fs.existsSync(outputPath)) {
        throw new Error('Thumbnail file was not created');
      }

      this.logger.log(
        `Generated thumbnail: ${outputPath} (${width}x${height} at ${timestamp}s)`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate thumbnail: ${errorMessage}`);
      throw new Error(`Thumbnail generation failed: ${errorMessage}`);
    }
  }

  /**
   * Generate sprite sheet from video
   */
  async generateSprite(
    inputPath: string,
    outputPath: string,
    fps: number = 0.1,
    cols: number = 10,
    rows: number = 10,
    tileWidth: number = 160,
    tileHeight: number = 120,
    startTime: number = 0
  ): Promise<void> {
    try {
      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      await fs.promises.mkdir(outputDir, { recursive: true });

      // Build FFmpeg arguments as array (avoids shell interpretation issues)
      const args: string[] = [
        '-y', // Overwrite output file
      ];

      // Add start time before input for input seeking (faster)
      if (startTime > 0) {
        args.push('-ss', startTime.toString());
      }

      args.push(
        '-i',
        inputPath, // Input file (no quotes needed with spawn)
        '-vf',
        `fps=${fps},scale=${tileWidth}:${tileHeight},tile=${cols}x${rows}`, // Video filter
        '-frames:v',
        '1', // Tile filter produces a single output frame containing all tiles
        '-q:v',
        '2', // High quality
        outputPath // Output file (no quotes needed with spawn)
      );

      this.logger.debug(`Generating sprite: ffmpeg ${args.join(' ')}`);

      // Use spawn instead of exec to avoid shell interpretation issues
      await this.executeWithSpawn(args, 0);

      // Verify output file was created
      if (!fs.existsSync(outputPath)) {
        throw new Error('Sprite file was not created');
      }

      this.logger.log(
        `Generated sprite: ${outputPath} (${cols}x${rows} tiles, ${tileWidth}x${tileHeight} each)`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate sprite: ${errorMessage}`);
      throw new Error(`Sprite generation failed: ${errorMessage}`);
    }
  }

  /**
   * Transcode video with specified options
   */
  async transcode(
    inputPath: string,
    outputPath: string,
    options: TranscodeOptions = {},
    onProgress?: (progress: number) => void
  ): Promise<void> {
    try {
      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      await fs.promises.mkdir(outputDir, { recursive: true });

      // Get input duration for progress calculation
      let totalDuration = 0;
      try {
        const probeResult = await this.probe(inputPath);
        totalDuration = probeResult.format.duration;
      } catch (error) {
        this.logger.warn(
          `Could not probe input for progress tracking: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Build FFmpeg command
      const command = this.buildTranscodeCommand(
        inputPath,
        outputPath,
        options
      );

      this.logger.debug(`Transcoding: ${command}`);
      this.logger.log(`Starting transcode: ${inputPath} -> ${outputPath}`);

      // Execute with progress tracking
      await this.executeWithProgressInner(command, totalDuration, onProgress);

      // Verify output file was created
      if (!fs.existsSync(outputPath)) {
        throw new Error('Transcoded file was not created');
      }

      this.logger.log(`Transcode completed: ${outputPath}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to transcode: ${errorMessage}`);
      throw new Error(`Transcode failed: ${errorMessage}`);
    }
  }

  /**
   * Build FFmpeg transcode command from options
   */
  private buildTranscodeCommand(
    inputPath: string,
    outputPath: string,
    options: TranscodeOptions
  ): string {
    const args = ['ffmpeg', '-y']; // Start with ffmpeg and overwrite flag

    // Input file
    args.push(`-i "${inputPath}"`);

    // Video codec
    if (options.videoCodec) {
      args.push(`-c:v ${options.videoCodec}`);
    } else {
      args.push('-c:v libx264'); // Default to H.264
    }

    // Audio codec
    if (options.audioCodec) {
      args.push(`-c:a ${options.audioCodec}`);
    } else {
      args.push('-c:a aac'); // Default to AAC
    }

    // Video resolution
    if (options.width && options.height) {
      args.push(`-vf scale=${options.width}:${options.height}`);
    }

    // Video bitrate
    if (options.videoBitrate) {
      args.push(`-b:v ${options.videoBitrate}`);
    }

    // Audio bitrate
    if (options.audioBitrate) {
      args.push(`-b:a ${options.audioBitrate}`);
    }

    // CRF (Constant Rate Factor) for quality-based encoding
    if (options.crf !== undefined) {
      args.push(`-crf ${options.crf}`);
    }

    // Preset for encoding speed/quality tradeoff
    if (options.preset) {
      args.push(`-preset ${options.preset}`);
    }

    // Profile and level
    if (options.profile) {
      args.push(`-profile:v ${options.profile}`);
    }
    if (options.level) {
      args.push(`-level ${options.level}`);
    }

    // Pixel format
    if (options.pixelFormat) {
      args.push(`-pix_fmt ${options.pixelFormat}`);
    }

    // Frame rate
    if (options.frameRate) {
      args.push(`-r ${options.frameRate}`);
    }

    // Keyframe interval
    if (options.keyframeInterval) {
      args.push(`-g ${options.keyframeInterval}`);
    }

    // Rate control
    if (options.maxrate) {
      args.push(`-maxrate ${options.maxrate}`);
    }
    if (options.bufsize) {
      args.push(`-bufsize ${options.bufsize}`);
    }

    // Audio settings
    if (options.audioSampleRate) {
      args.push(`-ar ${options.audioSampleRate}`);
    }
    if (options.audioChannels) {
      args.push(`-ac ${options.audioChannels}`);
    }

    // Output format
    if (options.format) {
      args.push(`-f ${options.format}`);
    }

    // Output file
    args.push(`"${outputPath}"`);

    return args.join(' ');
  }

  /**
   * Execute FFmpeg command with progress tracking
   */
  private async executeWithProgressInner(
    command: string,
    totalDuration: number,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = exec(command);
      let stderr = '';

      process.stderr?.on('data', (data: string) => {
        stderr += data;

        // Parse progress from FFmpeg stderr
        if (onProgress && totalDuration > 0) {
          const timeMatch = data.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
          if (timeMatch) {
            const hours = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2]);
            const seconds = parseFloat(timeMatch[3]);
            const currentTime = hours * 3600 + minutes * 60 + seconds;
            const progress = Math.min(100, (currentTime / totalDuration) * 100);
            onProgress(progress);
          }
        }
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(`FFmpeg exited with code ${code}. stderr: ${stderr}`)
          );
        }
      });

      process.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Execute FFmpeg command with arguments array and progress tracking
   * Uses spawn with args array to avoid shell interpretation issues
   */
  async executeWithProgress(
    args: string[],
    onProgress?: (progress: number) => void
  ): Promise<void> {
    // Try to estimate total duration from input files for progress tracking
    let totalDuration = 0;
    const inputIndex = args.findIndex((arg) => arg === '-i');
    if (inputIndex !== -1 && inputIndex + 1 < args.length) {
      const inputFile = args[inputIndex + 1].replace(/"/g, '');
      try {
        const probeResult = await this.probe(inputFile);
        totalDuration = probeResult.format.duration;
      } catch (error) {
        this.logger.warn(
          `Could not probe input for progress tracking: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return this.executeWithSpawn(args, totalDuration, onProgress);
  }

  /**
   * Execute FFmpeg using spawn with args array (avoids shell interpretation issues)
   */
  private async executeWithSpawn(
    args: string[],
    totalDuration: number,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.logger.debug(`FFmpeg spawn: ffmpeg ${args.join(' ')}`);

      const process = spawn('ffmpeg', args);
      let stderr = '';

      process.stderr?.on('data', (data: Buffer) => {
        const dataStr = data.toString();
        stderr += dataStr;

        // Parse progress from FFmpeg stderr
        if (onProgress && totalDuration > 0) {
          const timeMatch = dataStr.match(
            /time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/
          );
          if (timeMatch) {
            const hours = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2]);
            const seconds = parseFloat(timeMatch[3]);
            const currentTime = hours * 3600 + minutes * 60 + seconds;
            const progress = Math.min(100, (currentTime / totalDuration) * 100);
            onProgress(progress);
          }
        }
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(`FFmpeg exited with code ${code}. stderr: ${stderr}`)
          );
        }
      });

      process.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Extract audio from video file
   */
  async extractAudio(
    inputPath: string,
    outputPath: string,
    format: string = 'wav'
  ): Promise<void> {
    try {
      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      await fs.promises.mkdir(outputDir, { recursive: true });

      const command = [
        'ffmpeg',
        '-y', // Overwrite output file
        `-i "${inputPath}"`, // Input file
        '-vn', // No video
        '-ac 1', // Convert to mono (1 channel) for speech recognition
        '-ar 16000', // 16kHz sample rate (optimal for speech recognition)
        `-f ${format}`, // Output format
        `"${outputPath}"`, // Output file
      ].join(' ');

      this.logger.debug(`Extracting audio: ${command}`);

      const { stderr } = await execAsync(command);

      if (stderr) {
        this.logger.debug(`FFmpeg stderr: ${stderr}`);
      }

      // Verify output file was created
      if (!fs.existsSync(outputPath)) {
        throw new Error('Audio file was not created');
      }

      this.logger.log(`Extracted audio: ${outputPath}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to extract audio: ${errorMessage}`);
      throw new Error(`Audio extraction failed: ${errorMessage}`);
    }
  }

  /**
   * Get video duration in seconds
   */
  async getDuration(filePath: string): Promise<number> {
    try {
      const probeResult = await this.probe(filePath);
      return probeResult.format.duration;
    } catch (error) {
      this.logger.error(
        `Failed to get duration for ${filePath}: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Check if FFmpeg is available
   */
  async checkAvailability(): Promise<boolean> {
    try {
      await execAsync('ffmpeg -version');
      await execAsync('ffprobe -version');
      return true;
    } catch (error) {
      this.logger.error(
        'FFmpeg is not available:',
        error instanceof Error ? error.message : String(error)
      );
      return false;
    }
  }
}
