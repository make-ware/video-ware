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
    side_data_list?: Array<{
      side_data_type: string;
      rotation?: number;
    }>;
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
   * Execute a command using spawn and capture the output.
   * This function also manages a capped stderr buffer to prevent memory leaks.
   */

  /**
   * Execute a command using spawn and capture the output.
   * This function also manages a capped stderr buffer to prevent memory leaks.
   */
  private async executeWithCappedStderr(
    command: string,
    args: string[],
    totalDuration: number = 0,
    onProgress?: (progress: number) => void
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      this.logger.debug(`FFmpeg spawn: ${command} ${args.join(' ')}`);
      const process = spawn(command, args);

      let stdout = '';
      const stderrLines: string[] = [];
      const maxStderrLines = 20;

      process.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      process.stderr?.on('data', (data: Buffer) => {
        const dataStr = data.toString();
        const lines = dataStr.split('\n').filter((line) => line.length > 0);
        stderrLines.push(...lines);
        if (stderrLines.length > maxStderrLines) {
          stderrLines.splice(0, stderrLines.length - maxStderrLines);
        }

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
        const stderr = stderrLines.join('\n');
        if (code === 0) {
          resolve({ stdout, stderr });
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
   * Probe media file to get metadata
   */
  async probe(filePath: string): Promise<ProbeResult> {
    try {
      // Verify file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const args = [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        filePath,
      ];
      this.logger.debug(`Probing file: ffprobe ${args.join(' ')}`);

      const { stdout, stderr } = await this.executeWithCappedStderr(
        'ffprobe',
        args
      );

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

      const args = [
        '-y', // Overwrite output file
        '-ss',
        timestamp.toString(), // Seek to timestamp
        '-i',
        inputPath, // Input file
        '-vframes',
        '1', // Extract single frame
        '-vf',
        `scale=${width}:${height}`, // Scale to desired size
        '-q:v',
        '2', // High quality
        '-update',
        '1', // Update the same file (required for single image output)
        outputPath, // Output file
      ];

      this.logger.debug(`Generating thumbnail: ffmpeg ${args.join(' ')}`);

      const { stderr } = await this.executeWithCappedStderr('ffmpeg', args);

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
      await this.executeWithCappedStderr('ffmpeg', args);

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
      const args = this.buildTranscodeCommand(inputPath, outputPath, options);

      this.logger.debug(`Transcoding: ffmpeg ${args.join(' ')}`);
      this.logger.log(`Starting transcode: ${inputPath} -> ${outputPath}`);

      // Execute with progress tracking
      await this.executeWithCappedStderr(
        'ffmpeg',
        args,
        totalDuration,
        onProgress
      );

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
  ): string[] {
    const args: string[] = ['-y']; // Start with overwrite flag

    // Input file
    args.push('-i', inputPath);

    // Video codec
    if (options.videoCodec) {
      args.push('-c:v', options.videoCodec);
    } else {
      args.push('-c:v', 'libx264'); // Default to H.264
    }

    // Audio codec
    if (options.audioCodec) {
      args.push('-c:a', options.audioCodec);
    } else {
      args.push('-c:a', 'aac'); // Default to AAC
    }

    // Video resolution
    if (options.width && options.height) {
      args.push('-vf', `scale=${options.width}:${options.height}`);
    }

    // Video bitrate
    if (options.videoBitrate) {
      args.push('-b:v', options.videoBitrate);
    }

    // Audio bitrate
    if (options.audioBitrate) {
      args.push('-b:a', options.audioBitrate);
    }

    // CRF (Constant Rate Factor) for quality-based encoding
    if (options.crf !== undefined) {
      args.push('-crf', options.crf.toString());
    }

    // Preset for encoding speed/quality tradeoff
    if (options.preset) {
      args.push('-preset', options.preset);
    }

    // Profile and level
    if (options.profile) {
      args.push('-profile:v', options.profile);
    }
    if (options.level) {
      args.push('-level', options.level);
    }

    // Pixel format
    if (options.pixelFormat) {
      args.push('-pix_fmt', options.pixelFormat);
    }

    // Frame rate
    if (options.frameRate) {
      args.push('-r', options.frameRate.toString());
    }

    // Keyframe interval
    if (options.keyframeInterval) {
      args.push('-g', options.keyframeInterval.toString());
    }

    // Rate control
    if (options.maxrate) {
      args.push('-maxrate', options.maxrate);
    }
    if (options.bufsize) {
      args.push('-bufsize', options.bufsize);
    }

    // Audio settings
    if (options.audioSampleRate) {
      args.push('-ar', options.audioSampleRate.toString());
    }
    if (options.audioChannels) {
      args.push('-ac', options.audioChannels.toString());
    }

    // Output format
    if (options.format) {
      args.push('-f', options.format);
    }

    // Output file
    args.push(outputPath);

    return args;
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

      const args = [
        '-y', // Overwrite output file
        '-i',
        inputPath, // Input file
        '-vn', // No video
        '-ac',
        '1', // Convert to mono (1 channel) for speech recognition
        '-ar',
        '16000', // 16kHz sample rate (optimal for speech recognition)
        '-f',
        format, // Output format
        outputPath, // Output file
      ];

      this.logger.debug(`Extracting audio: ffmpeg ${args.join(' ')}`);

      const { stderr } = await this.executeWithCappedStderr('ffmpeg', args);

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
   * Execute FFmpeg command with progress tracking
   * This is a public wrapper around executeWithCappedStderr for direct command execution
   */
  async executeWithProgress(
    args: string[],
    onProgress?: (progress: number) => void
  ): Promise<void> {
    try {
      // Try to extract input file path from args for duration calculation
      let totalDuration = 0;
      if (onProgress) {
        const inputIndex = args.indexOf('-i');
        if (inputIndex >= 0 && inputIndex < args.length - 1) {
          const inputPath = args[inputIndex + 1];
          try {
            const probeResult = await this.probe(inputPath);
            totalDuration = probeResult.format.duration;
          } catch (error) {
            this.logger.warn(
              `Could not probe input for progress tracking: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      }

      this.logger.debug(`Executing FFmpeg: ffmpeg ${args.join(' ')}`);

      await this.executeWithCappedStderr(
        'ffmpeg',
        args,
        totalDuration,
        onProgress
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to execute FFmpeg: ${errorMessage}`);
      throw new Error(`FFmpeg execution failed: ${errorMessage}`);
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
