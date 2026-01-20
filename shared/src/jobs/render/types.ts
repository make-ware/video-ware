/**
 * Render job types
 * Defines step types, input types, and output types for render jobs
 */

import type {
  ProbeOutput,
  RenderTimelinePayload,
} from '../../types/task-contracts.js';
import type { Media } from '../../schema/media.js';

/**
 * Render step type enum
 * Defines the streamlined steps in a render job
 */
export enum RenderStepType {
  PREPARE = 'render:prepare',
  EXECUTE = 'render:execute',
  FINALIZE = 'render:finalize',
}

/**
 * Input for the PREPARE step
 * Resolves media files and ensures they are available in the required location
 */
export interface TaskRenderPrepareStep {
  type: 'prepare';
  /** ID of the timeline being rendered */
  timelineId: string;
  /** Tracks from the render payload */
  tracks: RenderTimelinePayload['tracks'];
}

/**
 * Input for the EXECUTE step
 * Performs the actual rendering (FFmpeg or Google Cloud)
 */
export interface TaskRenderExecuteStep {
  type: 'execute';
  /** ID of the timeline being rendered */
  timelineId: string;
  /** Tracks from the render payload */
  tracks: RenderTimelinePayload['tracks'];
  /** Output settings for the render */
  outputSettings: RenderTimelinePayload['outputSettings'];
}

/**
 * Input for the FINALIZE step
 * Probes and creates records for the rendered file
 * Uses deterministic path: ./data/renders/<taskId>/output.<format>
 */
export interface TaskRenderFinalizeStep {
  type: 'finalize';
  /** ID of the timeline being rendered */
  timelineId: string;
  /** Workspace ID */
  workspaceId: string;
  /** Version number */
  version: number;
  /** Output format (e.g., 'mp4') - used to determine file path */
  format: string;
}

/**
 * Union type of all render step inputs
 */
export type TaskRenderInput =
  | TaskRenderPrepareStep
  | TaskRenderExecuteStep
  | TaskRenderFinalizeStep;

/**
 * Output from the PREPARE step
 */
export interface TaskRenderPrepareStepOutput {
  /** Map of media ID to resolved media and file path (Local or GCS) */
  clipMediaMap: Record<string, { media: Media; filePath: string }>;
}

/**
 * Output from the EXECUTE step
 */
export interface TaskRenderExecuteStepOutput {
  /** Local path to the rendered file or Cloud URI */
  outputPath: string;
  /** Storage path where the file was uploaded (if handled during execute) */
  storagePath?: string;
  /** Whether the output is local or cloud */
  isLocal: boolean;
  /** Optional probe output of the rendered video */
  probeOutput?: ProbeOutput;
}

/**
 * Output from the FINALIZE step
 */
export interface TaskRenderFinalizeStepOutput {
  /** ID of the created File record */
  fileId: string;
  /** ID of the created TimelineRender record */
  timelineRenderId: string;
}

/**
 * Union type of all render step outputs
 */
export type TaskRenderResult =
  | TaskRenderPrepareStepOutput
  | TaskRenderExecuteStepOutput
  | TaskRenderFinalizeStepOutput;

// Legacy type aliases for backward compatibility - will be removed after migration
export type TaskRenderResolveClipsStep = TaskRenderPrepareStep;
export type TaskRenderComposeStep = TaskRenderExecuteStep;
export type TaskRenderUploadStep = TaskRenderExecuteStep;
export type TaskRenderCreateRecordsStep = TaskRenderFinalizeStep;

export type TaskRenderResolveClipsStepOutput = TaskRenderPrepareStepOutput;
export type TaskRenderComposeStepOutput = TaskRenderExecuteStepOutput;
export type TaskRenderUploadStepOutput = { storagePath: string };
export type TaskRenderCreateRecordsStepOutput = TaskRenderFinalizeStepOutput;
