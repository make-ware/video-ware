/**
 * Executor interfaces for render operations
 * Step input/output types are now exported from @project/shared/jobs
 */

import type {
  ProbeOutput,
  RenderTimelinePayload,
  Media,
} from '@project/shared';

// Re-export step input/output types from shared for backward compatibility
export type {
  TaskRenderResolveClipsStep as ResolveClipsStepInput,
  TaskRenderComposeStep as ComposeStepInput,
  TaskRenderUploadStep as UploadStepInput,
  TaskRenderCreateRecordsStep as CreateRecordsStepInput,
  TaskRenderResolveClipsStepOutput as ResolveClipsOutput,
  TaskRenderComposeStepOutput as ComposeOutput,
  TaskRenderUploadStepOutput as UploadOutput,
  TaskRenderCreateRecordsStepOutput as CreateRecordsOutput,
} from '@project/shared/jobs';

// ============================================================================
// Executor Result Types
// ============================================================================

/**
 * Result from resolving clip media files (PREPARE step)
 */
export interface ResolveClipsResult {
  /** Map of media ID to resolved media and file path (local or cloud) */
  clipMediaMap: Record<string, { media: Media; filePath: string }>;
}

/**
 * Result from executing a render (EXECUTE step)
 */
export interface RenderExecutorResult {
  /** Local path to output file or Cloud URI */
  outputPath: string;
  /** Final storage path if uploaded during execution */
  storagePath?: string;
  /** Whether the result is local or cloud */
  isLocal: boolean;
  /** Optional probe output of the rendered video */
  probeOutput?: ProbeOutput;
}

// ============================================================================
// Executor Interfaces
// ============================================================================

/**
 * Executor for resolving and preparing media files for rendering
 */
export interface IPrepareExecutor {
  execute(
    timelineId: string,
    tracks: RenderTimelinePayload['tracks']
  ): Promise<ResolveClipsResult>;
}

/**
 * Generic interface for render executors (FFmpeg, Google Cloud Transcoder)
 */
export interface IRenderExecutor {
  execute(
    tracks: RenderTimelinePayload['tracks'],
    clipMediaMap: Record<string, { media: Media; filePath: string }>,
    outputName: string,
    outputSettings: RenderTimelinePayload['outputSettings'],
    onProgress?: (progress: number) => void
  ): Promise<RenderExecutorResult>;
}

/**
 * Executor for uploading rendered files to storage
 */
export interface IUploadExecutor {
  execute(
    outputPath: string,
    storagePath: string
  ): Promise<{ storagePath: string }>;
}
