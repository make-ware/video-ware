import { Injectable, Logger } from '@nestjs/common';
import {
  FFmpegService,
  ProbeResult as FFmpegProbeResult,
} from '../../../shared/services/ffmpeg.service';
import type { IProbeExecutor, ProbeResult } from '../interfaces';
import type { ProbeOutput } from '@project/shared';

/**
 * FFmpeg implementation of the Probe Executor
 * Extracts metadata from media files using FFprobe
 */
@Injectable()
export class FFmpegProbeExecutor implements IProbeExecutor {
  private readonly logger = new Logger(FFmpegProbeExecutor.name);

  constructor(private readonly ffmpegService: FFmpegService) {}

  async execute(filePath: string): Promise<ProbeResult> {
    this.logger.debug(`Probing file: ${filePath}`);

    const ffmpegResult = await this.ffmpegService.probe(filePath);
    const probeOutput = this.convertResult(ffmpegResult, ffmpegResult);

    return { probeOutput };
  }

  /**
   * Extract date from FFmpeg metadata tags
   * Tries common date fields: creation_time, date, DATE, etc.
   */
  private extractDateFromTags(result: FFmpegProbeResult): Date | null {
    // Try format tags first (most common location)
    if (result.format?.tags) {
      const dateStr =
        result.format.tags.creation_time ||
        result.format.tags.date ||
        result.format.tags.DATE ||
        result.format.tags['com.apple.quicktime.creationdate'];
      if (dateStr) {
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
    }

    // Try video stream tags
    const videoStream = result.streams.find((s) => s.codec_type === 'video');
    if (videoStream?.tags) {
      const dateStr =
        videoStream.tags.creation_time ||
        videoStream.tags.date ||
        videoStream.tags.DATE;
      if (dateStr) {
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
    }

    return null;
  }

  private convertResult(
    result: FFmpegProbeResult,
    originalResult: FFmpegProbeResult
  ): ProbeOutput {
    const videoStream = result.streams.find((s) => s.codec_type === 'video');
    const audioStream = result.streams.find((s) => s.codec_type === 'audio');

    if (!videoStream) {
      throw new Error('No video stream found in input file');
    }

    const probeOutput: ProbeOutput = {
      duration: parseFloat(String(result.format.duration || 0)),
      width: videoStream.width || 0,
      height: videoStream.height || 0,
      codec: videoStream.codec_name || 'unknown',
      fps: this.parseFps(
        videoStream.r_frame_rate || videoStream.avg_frame_rate
      ),
      bitrate: result.format.bit_rate
        ? parseInt(String(result.format.bit_rate))
        : undefined,
      format: result.format.format_name || 'unknown',
      size: result.format.size
        ? parseInt(String(result.format.size))
        : undefined,
      video: {
        codec: videoStream.codec_name || 'unknown',
        profile: videoStream.profile || undefined,
        width: videoStream.width || 0,
        height: videoStream.height || 0,
        aspectRatio: videoStream.display_aspect_ratio || undefined,
        pixFmt: videoStream.pix_fmt || undefined,
        level: videoStream.level?.toString() || undefined,
        colorSpace: videoStream.color_space || undefined,
      },
    };

    if (audioStream) {
      probeOutput.audio = {
        codec: audioStream.codec_name || 'unknown',
        channels: audioStream.channels || 0,
        sampleRate: audioStream.sample_rate || 0,
        bitrate: audioStream.bit_rate
          ? parseInt(String(audioStream.bit_rate))
          : undefined,
      };
    }

    // Extract date from metadata tags
    const extractedDate = this.extractDateFromTags(originalResult);
    if (extractedDate) {
      probeOutput.mediaDate = extractedDate;
    }

    return probeOutput;
  }

  private parseFps(fpsString?: string): number {
    if (!fpsString) return 0;
    const parts = fpsString.split('/');
    if (parts.length === 2) {
      const num = parseFloat(parts[0]);
      const den = parseFloat(parts[1]);
      return den !== 0 ? num / den : 0;
    }
    return parseFloat(fpsString) || 0;
  }
}
