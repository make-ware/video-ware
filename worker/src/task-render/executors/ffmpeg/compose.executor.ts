import { Injectable, Logger, Inject } from '@nestjs/common';
import { FFmpegService } from '../../../shared/services/ffmpeg.service';
import type { IRenderExecutor, RenderExecutorResult } from '../interfaces';
import type {
  RenderTimelinePayload,
  Media,
  TimelineTrack,
} from '@project/shared';

/**
 * FFmpeg-based executor for composing timelines
 * Pure operation - builds and executes FFmpeg command
 */
@Injectable()
export class FFmpegComposeExecutor implements IRenderExecutor {
  private readonly logger = new Logger(FFmpegComposeExecutor.name);

  constructor(
    @Inject(FFmpegService) private readonly ffmpegService: FFmpegService
  ) {
    if (!this.ffmpegService) {
      this.logger.error('FFmpegService is undefined in constructor!');
    } else {
      this.logger.log('FFmpegService injected successfully');
    }
  }

  async execute(
    tracks: RenderTimelinePayload['tracks'],
    clipMediaMap: Record<string, { media: Media; filePath: string }>,
    outputPath: string,
    outputSettings: RenderTimelinePayload['outputSettings'],
    onProgress?: (progress: number) => void
  ): Promise<RenderExecutorResult> {
    this.logger.log(`Composing timeline with ${tracks.length} tracks`);

    if (!this.ffmpegService) {
      throw new Error(
        'FFmpegService is not available (this.ffmpegService is undefined)'
      );
    }

    try {
      // Build FFmpeg command for timeline composition
      const ffmpegArgs = this.buildFFmpegCommand(
        tracks,
        clipMediaMap,
        outputPath,
        outputSettings
      );

      // Execute FFmpeg with progress tracking
      await this.ffmpegService.executeWithProgress(
        ffmpegArgs,
        onProgress || (() => {})
      );

      // Probe the rendered video to get metadata
      const probeResult = await this.ffmpegService.probe(outputPath);

      // Convert ProbeResult to ProbeOutput format
      const videoStream = probeResult.streams.find(
        (s) => s.codec_type === 'video'
      ) as (typeof probeResult.streams)[0] & {
        r_frame_rate?: string;
        avg_frame_rate?: string;
        width?: number;
        height?: number;
      };

      if (!videoStream) {
        throw new Error('No video stream found in rendered file');
      }

      // Parse FPS from FFmpeg format (e.g., "30/1" -> 30)
      const parseFps = (fpsString: string | undefined): number => {
        if (!fpsString) return 0;
        const [num, den] = fpsString.split('/').map(Number);
        return den && den > 0 ? num / den : 0;
      };

      const probeOutput = {
        duration: parseFloat(String(probeResult.format.duration)) || 0,
        width: videoStream.width || 0,
        height: videoStream.height || 0,
        displayWidth: videoStream.width || 0,
        displayHeight: videoStream.height || 0,
        rotation: 0, // Rendered output has no rotation
        codec: videoStream.codec_name || 'unknown',
        fps:
          parseFps(videoStream.r_frame_rate || videoStream.avg_frame_rate) || 0,
        bitrate: parseInt(String(probeResult.format.bit_rate)) || undefined,
        format: probeResult.format.format_name || 'unknown',
        size: parseInt(String(probeResult.format.size)) || undefined,
      };

      this.logger.log(`Timeline composition completed: ${outputPath}`);
      return { outputPath, probeOutput, isLocal: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Timeline composition failed: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Build FFmpeg command for timeline composition
   */
  private buildFFmpegCommand(
    tracks: TimelineTrack[],
    clipMediaMap: Record<string, { media: Media; filePath: string }>,
    outputPath: string,
    outputSettings: RenderTimelinePayload['outputSettings']
  ): string[] {
    // Start with -y to overwrite output without prompting
    const args: string[] = ['-y'];
    const filterComplex: string[] = [];
    const inputFileMap = new Map<string, number>();
    let inputCounter = 0;

    // Helper to get input index
    const getInputIndex = (assetId: string): number => {
      if (!inputFileMap.has(assetId)) {
        const clip = clipMediaMap[assetId];
        if (!clip) {
          throw new Error(`Media not found for asset ID: ${assetId}`);
        }
        args.push('-i', clip.filePath);
        inputFileMap.set(assetId, inputCounter++);
      }
      return inputFileMap.get(assetId) as number;
    };

    // Calculate output dimensions
    const [targetWidth, targetHeight] = outputSettings.resolution
      .split('x')
      .map(Number);

    // Helper to format color
    const formatColor = (hex: string | undefined) => {
      if (!hex) return 'white';
      // Ensure hex starts with 0x for FFmpeg if it's #RRGGBB
      if (hex.startsWith('#')) return hex.replace('#', '0x') + 'FF'; // Adding alpha
      return hex;
    };

    // Round time values to avoid floating-point precision issues (e.g. 18.599999999999998)
    // Composite clips with decimal segments can accumulate errors; millisecond precision is sufficient
    const fmtTime = (t: number): number => Math.round(t * 1000) / 1000;

    // Sort tracks by layer
    const sortedTracks = [...tracks].sort(
      (a, b) => (a.layer || 0) - (b.layer || 0)
    );

    let lastVideoLabel = '[base]';
    const audioInputs: string[] = [];

    // Create a base black background
    // Calculate total duration (use fmtTime to avoid floating-point accumulation from composite segments)
    let totalDuration = 0;
    for (const track of sortedTracks) {
      for (const seg of track.segments) {
        const end = fmtTime(seg.time.start + seg.time.duration);
        if (end > totalDuration) totalDuration = end;
      }
    }
    totalDuration = totalDuration || 1;
    filterComplex.push(
      `color=c=black:s=${targetWidth}x${targetHeight}:d=${fmtTime(totalDuration)}[base]`
    );

    // Process Video/Image/Text Tracks
    for (const track of sortedTracks) {
      if (track.type === 'audio') {
        // Audio handled separately
        for (const seg of track.segments) {
          if (!seg.assetId) continue;

          const clip = clipMediaMap[seg.assetId];
          if (!clip) {
            this.logger.warn(`Media not found for asset ID: ${seg.assetId}`);
            continue;
          }

          // Check if media has audio streams
          const hasAudio = !!(
            clip.media?.mediaData as unknown as { audio?: boolean }
          )?.audio;

          if (!hasAudio) {
            this.logger.debug(
              `Skipping audio for segment ${seg.id} as media ${seg.assetId} has no audio streams`
            );
            continue;
          }

          const idx = getInputIndex(seg.assetId);
          const sourceStart = fmtTime(seg.time.sourceStart || 0);
          const duration = fmtTime(seg.time.duration);
          const start = fmtTime(seg.time.start);

          // Trimming and Delay
          // adelay is in milliseconds
          const delayMs = Math.round(start * 1000);

          // Filter: trim -> volume -> adelay
          const volume = seg.audio?.volume ?? 1.0;

          filterComplex.push(
            `[${idx}:a]atrim=start=${sourceStart}:duration=${duration},asetpts=PTS-STARTPTS,volume=${volume},adelay=${delayMs}|${delayMs}[${seg.id}_delayed]`
          );
          audioInputs.push(`[${seg.id}_delayed]`);
        }
        continue;
      }

      // Visual Tracks (Video, Image, Text)
      for (const seg of track.segments) {
        if (seg.type === 'text') {
          // Use drawtext on top of the current video chain
          const content = seg.text?.content || '';
          const fontSize = seg.text?.fontSize || 24;
          const fontColor = formatColor(seg.text?.color);
          const x = seg.text?.x || '(w-text_w)/2';
          const y = seg.text?.y || '(h-text_h)/2';

          const start = fmtTime(seg.time.start);
          const end = fmtTime(start + seg.time.duration);
          const enable = `between(t,${start},${end})`;

          const nextLabel = `[v_txt_${seg.id}]`;

          // Escape text for FFmpeg
          const escapedContent = content
            .replace(/:/g, '\\:')
            .replace(/'/g, "\\'");

          filterComplex.push(
            `${lastVideoLabel}drawtext=text='${escapedContent}':fontsize=${fontSize}:fontcolor=${fontColor}:x=${x}:y=${y}:enable='${enable}'${nextLabel}`
          );

          lastVideoLabel = nextLabel;
          continue;
        }

        // For Video/Image
        if (!seg.assetId) continue;
        const idx = getInputIndex(seg.assetId);

        const sourceStart = fmtTime(seg.time.sourceStart || 0);
        const duration = fmtTime(seg.time.duration);
        const start = fmtTime(seg.time.start);

        // Prepare the segment: trim -> scale -> setpts
        // Scale logic
        let scaleFilter = '';
        const targetW = seg.video?.width;
        const targetH = seg.video?.height;

        if (targetW || targetH) {
          scaleFilter = `,scale=${targetW || -1}:${targetH || -1}`;
        } else if (seg.type === 'video') {
          scaleFilter = `,scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2`;
        }

        // Trim filter
        let trim = '';
        if (seg.type === 'image') {
          // Use loop filter for images to repeat the frame
          trim = `loop=loop=-1:size=1:start=0,trim=start=${sourceStart}:duration=${duration},`;
        } else {
          trim = `trim=start=${sourceStart}:duration=${duration},`;
        }

        // Update the previous push to include time shift
        // `setpts=PTS-STARTPTS+${start}/TB`

        filterComplex.push(
          `[${idx}:v]${trim}setpts=PTS-STARTPTS+${start}/TB${scaleFilter}[v_seg_${seg.id}]`
        );

        // Overlay
        const overlayLabel = `[v_over_${seg.id}]`;
        const xPos = seg.video?.x || 0;
        const yPos = seg.video?.y || 0;
        const segmentEnd = fmtTime(start + duration);
        const enable = `between(t,${start},${segmentEnd})`;

        filterComplex.push(
          `${lastVideoLabel}[v_seg_${seg.id}]overlay=x=${xPos}:y=${yPos}:enable='${enable}':eof_action=pass${overlayLabel}`
        );
        lastVideoLabel = overlayLabel;
      }
    }

    // Mix Audio
    if (audioInputs.length > 0) {
      filterComplex.push(
        `${audioInputs.join('')}amix=inputs=${audioInputs.length}:duration=longest[outa]`
      );
    } else {
      filterComplex.push(
        `anullsrc=channel_layout=stereo:sample_rate=44100:d=${fmtTime(totalDuration)}[outa]`
      );
    }

    // Map Final Video
    // lastVideoLabel is the final output
    // We don't need null sink if we map lastVideoLabel directly.

    // Add filter complex
    args.push('-filter_complex', filterComplex.join('; '));

    // Map output streams
    args.push('-map', lastVideoLabel, '-map', '[outa]');

    // Add output settings
    args.push('-c:v', outputSettings.codec);

    // Add quality settings based on codec
    this.addQualitySettings(
      args,
      outputSettings.codec,
      targetWidth,
      targetHeight
    );

    // Use calculated dimensions
    args.push('-s', `${targetWidth}x${targetHeight}`);

    // Add audio codec with high quality settings (higher bitrate = larger files, better quality)
    args.push('-c:a', 'aac', '-b:a', '320k', '-ar', '48000');

    // Add output format
    args.push('-f', outputSettings.format);

    // Add output file
    args.push(outputPath);

    this.logger.debug(`FFmpeg command: ffmpeg ${args.join(' ')}`);
    return args;
  }

  /**
   * Add quality settings to FFmpeg args based on video codec
   */
  private addQualitySettings(
    args: string[],
    codec: string,
    width: number,
    height: number
  ): void {
    const codecLower = codec.toLowerCase();

    // Common quality settings for all codecs
    // Use veryslow preset for maximum quality (slower encoding, best compression/quality)
    args.push('-preset', 'veryslow');

    // Pixel format for compatibility (yuv420p works everywhere)
    args.push('-pix_fmt', 'yuv420p');

    if (codecLower === 'libx264' || codecLower === 'h264') {
      // H.264 quality settings
      // CRF 18: High quality (visually lossless, produces larger files)
      // Lower CRF = higher quality and larger file size
      args.push('-crf', '18');
      // Use high profile for better quality and compatibility
      args.push('-profile:v', 'high');
      // Set level based on resolution for compatibility
      if (width * height > 1920 * 1080) {
        args.push('-level', '4.2'); // 4K support
      } else {
        args.push('-level', '4.0'); // 1080p support
      }
      // Enable B-frames for better compression
      args.push('-bf', '2');
    } else if (
      codecLower === 'libx265' ||
      codecLower === 'h265' ||
      codecLower === 'hevc'
    ) {
      // H.265 quality settings
      // CRF 18: High quality (produces larger, higher quality files)
      // Lower CRF = higher quality and larger file size
      args.push('-crf', '18');
      // Use main profile
      args.push('-profile:v', 'main');
      // Set level based on resolution (use x265-params for level in libx265)
      if (width * height > 1920 * 1080) {
        args.push('-x265-params', 'level-idc=153:aq-mode=2:aq-strength=1.0'); // Level 5.1 for 4K
      } else {
        args.push('-x265-params', 'level-idc=120:aq-mode=2:aq-strength=1.0'); // Level 4.0 for 1080p
      }
    } else if (codecLower === 'libvpx-vp9' || codecLower === 'vp9') {
      // VP9 quality settings
      // VP9 uses -crf with range 0-63 (lower = better quality, larger files)
      // CRF 20: High quality setting for larger, higher quality output
      args.push('-crf', '20');
      // Set quality/speed tradeoff (0-9, lower = slower/better)
      args.push('-b:v', '0'); // Required for CRF mode in VP9
      args.push('-cpu-used', '1'); // 0-5, lower = better quality (1 for high quality)
    } else {
      // Fallback for unknown codecs - use CRF if codec supports it
      this.logger.warn(
        `Unknown codec "${codec}", using basic quality settings. Consider adding codec-specific optimizations.`
      );
    }
  }
}
