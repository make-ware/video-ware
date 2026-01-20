/**
 * Transcode job types
 * Defines step types, input types, and output types for transcode jobs
 */

import type { ProcessingProvider } from '../../enums.js';
import type {
  ProbeOutput,
  ThumbnailConfig,
  SpriteConfig,
  FilmstripConfig,
  TranscodeConfig,
} from '../../types/task-contracts.js';

/**
 * Transcode step type enum
 * Defines all possible steps in a transcode job
 */
export enum TranscodeStepType {
  PROBE = 'transcode:probe',
  THUMBNAIL = 'transcode:thumbnail',
  SPRITE = 'transcode:sprite',
  FILMSTRIP = 'transcode:filmstrip',
  TRANSCODE = 'transcode:transcode',
  AUDIO = 'transcode:audio',
  FINALIZE = 'transcode:finalize',
}

/**
 * Input for the PROBE step
 * Extracts metadata from the uploaded media file
 */
export interface TaskTranscodeProbeStep {
  type: 'probe';
  /** Path to the media file to probe */
  filePath: string;
  /** ID of the Upload record being processed */
  uploadId: string;
  /** ID of the Media record to update */
  mediaId: string;
}

/**
 * Input for the THUMBNAIL step
 * Generates a thumbnail image from the media file
 */
export interface TaskTranscodeThumbnailStep {
  type: 'thumbnail';
  /** Path to the media file */
  filePath: string;
  /** ID of the Upload record being processed */
  uploadId: string;
  /** ID of the Media record being processed (optional, will be resolved by processor if not provided) */
  mediaId?: string;
  /** Thumbnail generation configuration */
  config: ThumbnailConfig;
}

/**
 * Input for the SPRITE step
 * Generates a sprite sheet from the media file
 */
export interface TaskTranscodeSpriteStep {
  type: 'sprite';
  /** Path to the media file */
  filePath: string;
  /** ID of the Upload record being processed */
  uploadId: string;
  /** ID of the Media record being processed (optional, will be resolved by processor if not provided) */
  mediaId?: string;
  /** Sprite sheet generation configuration */
  config: SpriteConfig;
}

/**
 * Input for the FILMSTRIP step
 * Generates a filmstrip from the media file
 */
export interface TaskTranscodeFilmstripStep {
  type: 'filmstrip';
  /** Path to the media file */
  filePath: string;
  /** ID of the Upload record being processed */
  uploadId: string;
  /** ID of the Media record being processed (optional, will be resolved by processor if not provided) */
  mediaId?: string;
  /** Filmstrip generation configuration */
  config: FilmstripConfig;
}

/**
 * Input for the TRANSCODE step
 * Creates a proxy/transcoded version of the media file
 */
export interface TaskTranscodeTranscodeStep {
  type: 'transcode';
  /** Path to the media file */
  filePath: string;
  /** ID of the Upload record being processed */
  uploadId: string;
  /** ID of the Media record being processed (optional, will be resolved by processor if not provided) */
  mediaId?: string;
  /** Processing provider to use (ffmpeg or google-transcoder) */
  provider: ProcessingProvider;
  /** Transcoding configuration */
  config: TranscodeConfig;
}

/**
 * Input for the AUDIO step
 * Extracts audio-only track from the media file
 */
export interface TaskTranscodeAudioStep {
  type: 'audio';
  /** Path to the media file */
  filePath: string;
  /** ID of the Upload record being processed */
  uploadId: string;
  /** ID of the Media record being processed (optional, will be resolved by processor if not provided) */
  mediaId?: string;
  /** Audio format (default: 'mp3') */
  format?: 'mp3' | 'aac' | 'wav';
  /** Audio bitrate (default: '192k') */
  bitrate?: string;
  /** Number of audio channels (default: 2 for stereo) */
  channels?: number;
  /** Audio sample rate (default: 48000) */
  sampleRate?: number;
}

/**
 * Union type of all transcode step inputs
 */
export type TaskTranscodeInput =
  | TaskTranscodeProbeStep
  | TaskTranscodeThumbnailStep
  | TaskTranscodeSpriteStep
  | TaskTranscodeFilmstripStep
  | TaskTranscodeTranscodeStep
  | TaskTranscodeAudioStep;

// Legacy type aliases for backward compatibility during migration
/** @deprecated Use TaskTranscodeProbeStep instead */
export type ProbeStepInput = TaskTranscodeProbeStep;
/** @deprecated Use TaskTranscodeThumbnailStep instead */
export type ThumbnailStepInput = TaskTranscodeThumbnailStep;
/** @deprecated Use TaskTranscodeSpriteStep instead */
export type SpriteStepInput = TaskTranscodeSpriteStep;
/** @deprecated Use TaskTranscodeFilmstripStep instead */
export type FilmstripStepInput = TaskTranscodeFilmstripStep;
/** @deprecated Use TaskTranscodeTranscodeStep instead */
export type TranscodeStepInput = TaskTranscodeTranscodeStep;
/** @deprecated Use TaskTranscodeInput instead */
export type TranscodeJobInput = TaskTranscodeInput;

/**
 * Output from the PROBE step
 */
export interface TaskTranscodeProbeStepOutput {
  /** Probe metadata extracted from the media file */
  probeOutput: ProbeOutput;
  /** ID of the created Media record */
  mediaId: string;
}

/**
 * Output from the THUMBNAIL step
 */
export interface TaskTranscodeThumbnailStepOutput {
  /** Path to the generated thumbnail file */
  thumbnailPath: string;
  /** ID of the created File record */
  thumbnailFileId: string;
}

/**
 * Output from the SPRITE step
 */
export interface TaskTranscodeSpriteStepOutput {
  /** Path to the generated sprite sheet file */
  spritePath: string;
  /** ID of the created File record */
  spriteFileId: string;
}

/**
 * Output from the FILMSTRIP step
 */
export interface TaskTranscodeFilmstripStepOutput {
  /** Path to the generated filmstrip file */
  filmstripPath: string;
  /** ID of the created File record */
  filmstripFileId: string;
  /** IDs of all generated filmstrip file records */
  allFilmstripFileIds?: string[];
}

/**
 * Output from the TRANSCODE step
 */
export interface TaskTranscodeTranscodeStepOutput {
  /** Path to the transcoded proxy file */
  proxyPath: string;
  /** ID of the created File record */
  proxyFileId: string;
}

/**
 * Output from the AUDIO step
 */
export interface TaskTranscodeAudioStepOutput {
  /** Path to the extracted audio file */
  audioPath?: string;
  /** ID of the created File record */
  audioFileId?: string;
}

/**
 * Union type of all transcode step outputs
 */
export type TaskTranscodeResult =
  | TaskTranscodeProbeStepOutput
  | TaskTranscodeThumbnailStepOutput
  | TaskTranscodeSpriteStepOutput
  | TaskTranscodeFilmstripStepOutput
  | TaskTranscodeTranscodeStepOutput
  | TaskTranscodeAudioStepOutput;

// Legacy type aliases for backward compatibility during migration
/** @deprecated Use TaskTranscodeProbeStepOutput instead */
export type ProbeStepOutput = TaskTranscodeProbeStepOutput;
/** @deprecated Use TaskTranscodeThumbnailStepOutput instead */
export type ThumbnailStepOutput = TaskTranscodeThumbnailStepOutput;
/** @deprecated Use TaskTranscodeSpriteStepOutput instead */
export type SpriteStepOutput = TaskTranscodeSpriteStepOutput;
/** @deprecated Use TaskTranscodeFilmstripStepOutput instead */
export type FilmstripStepOutput = TaskTranscodeFilmstripStepOutput;
/** @deprecated Use TaskTranscodeTranscodeStepOutput instead */
export type TranscodeStepOutput = TaskTranscodeTranscodeStepOutput;
/** @deprecated Use TaskTranscodeResult instead */
export type TranscodeJobResult = TaskTranscodeResult;
