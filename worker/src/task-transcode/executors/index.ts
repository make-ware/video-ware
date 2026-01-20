/**
 * Transcode Executors
 *
 * Executors implement the strategy pattern for media processing operations.
 * Each executor type has a common interface that can be implemented by
 * different providers (FFmpeg, Google Cloud, etc.)
 *
 * Architecture:
 * - Interfaces define the contract for each operation type
 * - Implementations provide provider-specific logic
 * - Step processors use executors via dependency injection
 */

// Executor interfaces
export type {
  ProbeResult,
  ThumbnailConfig,
  ThumbnailResult,
  SpriteConfig,
  SpriteResult,
  TranscodeConfig,
  TranscodeResult,
  ProgressCallback,
  IProbeExecutor,
  IThumbnailExecutor,
  ISpriteExecutor,
  ITranscodeExecutor,
} from './interfaces';
export { EXECUTOR_TOKENS } from './interfaces';

// FFmpeg implementations
export { FFmpegProbeExecutor } from './ffmpeg/probe.executor';
export { FFmpegThumbnailExecutor } from './ffmpeg/thumbnail.executor';
export { FFmpegSpriteExecutor } from './ffmpeg/sprite.executor';
export { FFmpegTranscodeExecutor } from './ffmpeg/transcode.executor';
export { FFmpegAudioExecutor } from './ffmpeg/audio.executor';

// Google Cloud implementations
export { GoogleTranscodeExecutor } from './google/transcode.executor';
