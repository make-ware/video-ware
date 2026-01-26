/**
 * Executor Interfaces
 *
 * Define contracts for media processing operations.
 * Each interface represents a single responsibility.
 */

import type { ProbeOutput } from '@project/shared';

/**
 * Result from probing a media file
 */
export interface ProbeResult {
  probeOutput: ProbeOutput;
}

/**
 * Configuration for thumbnail generation
 */
export interface ThumbnailConfig {
  timestamp: number | 'midpoint';
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
}

/**
 * Result from thumbnail generation
 */
export interface ThumbnailResult {
  outputPath: string;
}

/**
 * Configuration for sprite sheet generation
 */
export interface SpriteConfig {
  fps: number;
  cols: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  sourceWidth?: number;
  sourceHeight?: number;
}

/**
 * Result from sprite generation
 */
export interface SpriteResult {
  outputPath: string;
}

/**
 * Configuration for video transcoding
 */
export interface TranscodeConfig {
  resolution: '720p' | '1080p' | 'original';
  codec: 'h264' | 'h265' | 'vp9';
  bitrate?: number;
  sourceWidth: number;
  sourceHeight: number;
  /** Display width after rotation (for aspect ratio calculation) */
  sourceDisplayWidth?: number;
  /** Display height after rotation (for aspect ratio calculation) */
  sourceDisplayHeight?: number;
  /** Rotation in degrees (0, 90, 180, 270) */
  rotation?: number;
}

/**
 * Result from video transcoding
 */
export interface TranscodeResult {
  outputPath: string;
}

/**
 * Progress callback for long-running operations
 */
export type ProgressCallback = (progress: number) => void;

/**
 * Probe Executor Interface
 * Extracts metadata from media files
 */
export interface IProbeExecutor {
  /**
   * Probe a media file and extract metadata
   * @param filePath Path to the media file
   * @returns Probe result with metadata
   */
  execute(filePath: string): Promise<ProbeResult>;
}

/**
 * Thumbnail Executor Interface
 * Generates thumbnail images from media files
 */
export interface IThumbnailExecutor {
  /**
   * Generate a thumbnail from a media file
   * @param filePath Path to the source media file
   * @param outputPath Path for the output thumbnail
   * @param config Thumbnail configuration
   * @param duration Video duration (for midpoint calculation)
   * @returns Thumbnail result
   */
  execute(
    filePath: string,
    outputPath: string,
    config: ThumbnailConfig,
    duration: number
  ): Promise<ThumbnailResult>;
}

/**
 * Sprite Executor Interface
 * Generates sprite sheets from media files
 */
export interface ISpriteExecutor {
  /**
   * Generate a sprite sheet from a media file
   * @param filePath Path to the source media file
   * @param outputPath Path for the output sprite
   * @param config Sprite configuration
   * @param startTime Optional start time offset in seconds
   * @returns Sprite result
   */
  execute(
    filePath: string,
    outputPath: string,
    config: SpriteConfig,
    startTime?: number
  ): Promise<SpriteResult>;
}

/**
 * Transcode Executor Interface
 * Transcodes video files to different formats/resolutions
 */
export interface ITranscodeExecutor {
  /**
   * Transcode a video file
   * @param filePath Path to the source video file
   * @param outputPath Path for the output video
   * @param config Transcode configuration
   * @param onProgress Optional progress callback
   * @returns Transcode result
   */
  execute(
    filePath: string,
    outputPath: string,
    config: TranscodeConfig,
    onProgress?: ProgressCallback
  ): Promise<TranscodeResult>;
}

/**
 * Injection tokens for executor interfaces
 */
export const EXECUTOR_TOKENS = {
  PROBE: 'IProbeExecutor',
  THUMBNAIL: 'IThumbnailExecutor',
  SPRITE: 'ISpriteExecutor',
  TRANSCODE: 'ITranscodeExecutor',
} as const;
