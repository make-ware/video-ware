/**
 * Transcode Processors
 *
 * Step processors for the transcode queue.
 * Each processor handles a specific step in the media processing pipeline.
 *
 * Architecture:
 * - Processors orchestrate the step execution
 * - Executors perform the actual media operations
 * - PocketBase service handles database operations
 */

export { TranscodeParentProcessor } from './transcode-parent.processor';
export { ProbeStepProcessor } from './probe-step.processor';
export { ThumbnailStepProcessor } from './thumbnail-step.processor';
export { SpriteStepProcessor } from './sprite-step.processor';
export { FilmstripStepProcessor } from './filmstrip-step.processor';
export { TranscodeStepProcessor } from './transcode-step.processor';
export { AudioStepProcessor } from './audio-step.processor';

// Re-export step types for external use
export type {
  // New job-prefixed types
  TaskTranscodeProbeStep,
  TaskTranscodeProbeStepOutput,
  TaskTranscodeThumbnailStep,
  TaskTranscodeThumbnailStepOutput,
  TaskTranscodeSpriteStep,
  TaskTranscodeSpriteStepOutput,
  TaskTranscodeFilmstripStep,
  TaskTranscodeFilmstripStepOutput,
  TaskTranscodeTranscodeStep,
  TaskTranscodeTranscodeStepOutput,
  TaskTranscodeAudioStep,
  TaskTranscodeAudioStepOutput,
  TaskTranscodeInput,
  TaskTranscodeResult,
  // Legacy type aliases (deprecated)
  ProbeStepInput,
  ProbeStepOutput,
  ThumbnailStepInput,
  ThumbnailStepOutput,
  SpriteStepInput,
  SpriteStepOutput,
  FilmstripStepInput,
  FilmstripStepOutput,
  TranscodeStepInput,
  TranscodeStepOutput,
  TranscodeJobInput,
  TranscodeJobResult,
  TranscodeStepType,
} from '@project/shared/jobs';
