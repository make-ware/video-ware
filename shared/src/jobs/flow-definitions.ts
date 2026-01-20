/**
 * Flow Definitions
 * Type-safe definitions for each job flow to ensure all required steps are included
 */

import { TranscodeStepType } from './transcode/types.js';
import type {
  ProcessUploadPayload,
  RenderTimelineConfig,
  DetectLabelsConfig,
} from '../types/task-contracts.js';

/**
 * Configuration for the Transcode flow
 */
export type TranscodeFlowConfig = Omit<
  ProcessUploadPayload,
  'uploadId' | 'mediaId'
>;

/**
 * Configuration for the Render flow
 */
export type RenderFlowConfig = RenderTimelineConfig;

/**
 * Configuration for the Labels flow
 */
export type LabelsFlowConfig = DetectLabelsConfig;

/**
 * Required steps for a complete transcode flow
 * This ensures we don't forget to add new steps to the flow builder
 */
export type TranscodeFlowSteps = {
  /** PROBE step - always required to extract media metadata */
  probe: {
    type: 'probe';
    required: true;
  };
  /** THUMBNAIL step - optional, generates a thumbnail image */
  thumbnail?: {
    type: 'thumbnail';
    required: false;
  };
  /** SPRITE step - optional, generates a sprite sheet for scrubbing */
  sprite?: {
    type: 'sprite';
    required: false;
  };
  /** FILMSTRIP step - optional, generates filmstrip for preview */
  filmstrip?: {
    type: 'filmstrip';
    required: false;
  };
  /** TRANSCODE step - optional, creates a proxy video */
  transcode?: {
    type: 'transcode';
    required: false;
  };
  /** AUDIO step - optional, extracts audio-only track */
  audio?: {
    type: 'audio';
    required: false;
  };
};

/**
 * Enum of all transcode step types that should be handled
 * This is a compile-time check to ensure all steps are accounted for
 */
export const TRANSCODE_FLOW_STEPS = {
  PROBE: TranscodeStepType.PROBE,
  THUMBNAIL: TranscodeStepType.THUMBNAIL,
  SPRITE: TranscodeStepType.SPRITE,
  FILMSTRIP: TranscodeStepType.FILMSTRIP,
  TRANSCODE: TranscodeStepType.TRANSCODE,
  AUDIO: TranscodeStepType.AUDIO,
} as const;

/**
 * Required steps for a complete render flow
 */
export type RenderFlowSteps = {
  /** PREPARE step - resolves clips and ensures media availability */
  prepare: {
    type: 'prepare';
    required: true;
  };
  /** EXECUTE step - runs FFmpeg or Google Cloud Transcoder */
  execute: {
    type: 'execute';
    required: true;
    dependsOn: ['prepare'];
  };
  /** FINALIZE step - probes output and creates database records */
  finalize: {
    type: 'finalize';
    required: true;
    dependsOn: ['execute'];
  };
};

/**
 * Enum of all render step types
 */
export const RENDER_FLOW_STEPS = {
  PREPARE: 'render:prepare' as const,
  EXECUTE: 'render:execute' as const,
  FINALIZE: 'render:finalize' as const,
} as const;

/**
 * Required steps for a complete labels/detection flow
 */
export type LabelsFlowSteps = {
  /** UPLOAD_TO_GCS step - uploads media to Google Cloud Storage */
  uploadToGcs: {
    type: 'upload_to_gcs';
    required: true;
  };
  /** LABEL_DETECTION step - detects labels/shots */
  labelDetection: {
    type: 'label_detection';
    required: true;
    dependsOn: ['uploadToGcs'];
  };
  /** OBJECT_TRACKING step - tracks objects across frames */
  objectTracking: {
    type: 'object_tracking';
    required: true;
    dependsOn: ['uploadToGcs'];
  };
  /** FACE_DETECTION step - detects faces */
  faceDetection: {
    type: 'face_detection';
    required: true;
    dependsOn: ['uploadToGcs'];
  };
  /** PERSON_DETECTION step - detects people */
  personDetection: {
    type: 'person_detection';
    required: true;
    dependsOn: ['uploadToGcs'];
  };
  /** SPEECH_TRANSCRIPTION step - transcribes speech to text */
  speechTranscription: {
    type: 'speech_transcription';
    required: true;
    dependsOn: ['uploadToGcs'];
  };
};

/**
 * Enum of all labels step types
 */
export const LABELS_FLOW_STEPS = {
  UPLOAD_TO_GCS: 'labels:upload_to_gcs' as const,
  LABEL_DETECTION: 'labels:label_detection' as const,
  OBJECT_TRACKING: 'labels:object_tracking' as const,
  FACE_DETECTION: 'labels:face_detection' as const,
  PERSON_DETECTION: 'labels:person_detection' as const,
  SPEECH_TRANSCRIPTION: 'labels:speech_transcription' as const,
} as const;

/**
 * Helper type to extract step types from a flow definition
 */
export type ExtractStepTypes<T> = {
  [K in keyof T]: T[K] extends { type: infer U } ? U : never;
}[keyof T];

/**
 * All possible transcode step types (for validation)
 */
export type TranscodeStepTypes = ExtractStepTypes<TranscodeFlowSteps>;

/**
 * All possible render step types (for validation)
 */
export type RenderStepTypes = ExtractStepTypes<RenderFlowSteps>;

/**
 * All possible labels step types (for validation)
 */
export type LabelsStepTypes = ExtractStepTypes<LabelsFlowSteps>;
