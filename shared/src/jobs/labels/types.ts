/**
 * Labels job types
 * Defines step types, input types, and output types for label detection jobs
 */

import type { DetectLabelsConfig } from '../../types/task-contracts.js';
import { LabelType, MediaType } from '../../enums.js';

/**
 * Detect labels step type enum
 */
export enum DetectLabelsStepType {
  UPLOAD_TO_GCS = 'labels:upload_to_gcs',
  LABEL_DETECTION = 'labels:label_detection',
  OBJECT_TRACKING = 'labels:object_tracking',
  FACE_DETECTION = 'labels:face_detection',
  PERSON_DETECTION = 'labels:person_detection',
  TEXT_DETECTION = 'labels:text_detection',
  SPEECH_TRANSCRIPTION = 'labels:speech_transcription',
  SPEAKER_TRANSCRIPTION = 'labels:speaker_transcription',
}

/**
 * The user-facing label job types tracked in the LabelJobs collection
 * (one record per media × type, pointing at the last Task that ran it).
 */
export const LABEL_JOB_TYPES = [
  'object',
  'shot',
  'face',
  'person',
  'text',
  'speech',
  'speaker',
] as const;

export type LabelJobType = (typeof LABEL_JOB_TYPES)[number];

/**
 * LabelJobs.jobType → the detect_labels step that produces it. `Record` over
 * LabelJobType so adding a new job type breaks the build until it is mapped.
 */
export const LABEL_JOB_TYPE_TO_STEP: Record<
  LabelJobType,
  DetectLabelsStepType
> = {
  object: DetectLabelsStepType.OBJECT_TRACKING,
  shot: DetectLabelsStepType.LABEL_DETECTION,
  face: DetectLabelsStepType.FACE_DETECTION,
  person: DetectLabelsStepType.PERSON_DETECTION,
  text: DetectLabelsStepType.TEXT_DETECTION,
  speech: DetectLabelsStepType.SPEECH_TRANSCRIPTION,
  speaker: DetectLabelsStepType.SPEAKER_TRANSCRIPTION,
};

/** Reverse of LABEL_JOB_TYPE_TO_STEP (detection steps only). */
export const STEP_TO_LABEL_JOB_TYPE: Partial<Record<string, LabelJobType>> =
  Object.fromEntries(
    Object.entries(LABEL_JOB_TYPE_TO_STEP).map(([jobType, step]) => [
      step,
      jobType as LabelJobType,
    ])
  );

/** LabelJobs.jobType → the DetectLabelsConfig toggle that requests it. */
export const LABEL_JOB_TYPE_TO_CONFIG_KEY: Record<
  LabelJobType,
  keyof DetectLabelsConfig
> = {
  object: 'detectObjects',
  shot: 'detectLabels',
  face: 'detectFaces',
  person: 'detectPersons',
  text: 'detectText',
  speech: 'detectSpeech',
  speaker: 'detectSpeakers',
};

/**
 * Whether a task payload config requests a label job type, mirroring the
 * payload half of LabelsFlowBuilder's gating (env ENABLE_* flags are the
 * other half): labels/objects default on when the config is silent,
 * faces/persons/speech/speakers are opt-in.
 */
export function isLabelTypeRequested(
  config: DetectLabelsConfig | undefined,
  jobType: LabelJobType
): boolean {
  const key = LABEL_JOB_TYPE_TO_CONFIG_KEY[jobType];
  if (jobType === 'object' || jobType === 'shot') {
    return config?.[key] !== false;
  }
  return config?.[key] === true;
}

/**
 * Label types that require visual frames — only video media can carry them.
 */
const VISUAL_LABEL_TYPES: ReadonlySet<LabelType> = new Set([
  LabelType.OBJECT,
  LabelType.SHOT,
  LabelType.PERSON,
  LabelType.FACE,
  LabelType.TEXT,
  LabelType.SEGMENT,
]);

/**
 * Label types derived from an audio track — carried by video (with audio) or
 * audio-only media.
 */
const AUDIO_LABEL_TYPES: ReadonlySet<LabelType> = new Set([
  LabelType.SPEECH,
  LabelType.SPEAKER,
]);

/**
 * Whether a media type can carry a given label type. Images carry no labels;
 * audio carries only speech/speaker; video carries all. Single source of truth
 * for tab/job/button visibility on the media detail & labels pages.
 */
export function mediaTypeSupportsLabelType(
  mediaType: MediaType,
  labelType: LabelType
): boolean {
  switch (mediaType) {
    case MediaType.IMAGE:
      return false;
    case MediaType.AUDIO:
      return AUDIO_LABEL_TYPES.has(labelType);
    case MediaType.VIDEO:
      return (
        VISUAL_LABEL_TYPES.has(labelType) || AUDIO_LABEL_TYPES.has(labelType)
      );
    default:
      return false;
  }
}

/**
 * The label job types applicable to a media type (a LabelJobType is a subset of
 * LabelType with identical string values).
 */
export function mediaTypeSupportsLabelJobType(
  mediaType: MediaType,
  jobType: LabelJobType
): boolean {
  return mediaTypeSupportsLabelType(mediaType, jobType as unknown as LabelType);
}

/** Whether a media type supports any label detection at all. */
export function mediaTypeSupportsLabels(mediaType: MediaType): boolean {
  return mediaType !== MediaType.IMAGE;
}

/**
 * Base input type shared by all label step processors
 */
export interface TaskDetectLabelsBaseStep {
  mediaId: string;
  workspaceRef: string;
  taskRef: string;
  version: number;
}

/**
 * Input for UPLOAD_TO_GCS step
 */
export interface TaskDetectLabelsUploadToGcsStep {
  type: 'upload_to_gcs';
  workspaceRef: string;
  mediaId: string;
  fileRef: string;
}

/**
 * Input for LABEL_DETECTION step
 */
export interface TaskDetectLabelsLabelDetectionStep extends TaskDetectLabelsBaseStep {
  type: 'label_detection';
  config?: {
    labelDetectionMode?: 'SHOT_MODE' | 'SHOT_AND_FRAME_MODE' | 'FRAME_MODE';
    videoConfidenceThreshold?: number;
  };
}

/**
 * Input for OBJECT_TRACKING step
 */
export interface TaskDetectLabelsObjectTrackingStep extends TaskDetectLabelsBaseStep {
  type: 'object_tracking';
  config?: Record<string, never>;
}

/**
 * Input for FACE_DETECTION step
 */
export interface TaskDetectLabelsFaceDetectionStep extends TaskDetectLabelsBaseStep {
  type: 'face_detection';
  config?: {
    includeBoundingBoxes?: boolean;
    includeAttributes?: boolean;
  };
}

/**
 * Input for PERSON_DETECTION step
 */
export interface TaskDetectLabelsPersonDetectionStep extends TaskDetectLabelsBaseStep {
  type: 'person_detection';
  config?: {
    includeBoundingBoxes?: boolean;
    includePoseLandmarks?: boolean;
    includeAttributes?: boolean;
  };
}

/**
 * Input for TEXT_DETECTION step (on-screen text OCR)
 */
export interface TaskDetectLabelsTextDetectionStep extends TaskDetectLabelsBaseStep {
  type: 'text_detection';
  config?: {
    /** BCP-47 language hints for OCR (e.g. ['en-US']) */
    languageHints?: string[];
    confidenceThreshold?: number;
  };
}

/**
 * Input for SPEECH_TRANSCRIPTION step
 */
export interface TaskDetectLabelsSpeechTranscriptionStep extends TaskDetectLabelsBaseStep {
  type: 'speech_transcription';
  config?: {
    languageCode?: string;
    enableAutomaticPunctuation?: boolean;
  };
}

/**
 * Input for SPEAKER_TRANSCRIPTION step
 *
 * Speaker-diarized STT (first provider: ElevenLabs Scribe). Unlike the GCVI
 * steps, the provider receives the media file directly from app storage, so
 * the step carries its own `fileRef` and has no UPLOAD_TO_GCS dependency.
 */
export interface TaskDetectLabelsSpeakerTranscriptionStep extends TaskDetectLabelsBaseStep {
  type: 'speaker_transcription';
  fileRef: string;
  config?: {
    modelId?: string;
    languageCode?: string;
    numSpeakers?: number;
    tagAudioEvents?: boolean;
  };
}

/**
 * Union type for all detect labels step inputs
 */
export type TaskDetectLabelsInput =
  | TaskDetectLabelsUploadToGcsStep
  | TaskDetectLabelsLabelDetectionStep
  | TaskDetectLabelsObjectTrackingStep
  | TaskDetectLabelsFaceDetectionStep
  | TaskDetectLabelsPersonDetectionStep
  | TaskDetectLabelsTextDetectionStep
  | TaskDetectLabelsSpeechTranscriptionStep
  | TaskDetectLabelsSpeakerTranscriptionStep;

/**
 * Base output type shared by all label step processors
 */
export interface TaskDetectLabelsBaseStepOutput {
  success: boolean;
  cacheHit: boolean;
  processorVersion: string;
  processingTimeMs?: number;
  error?: string;
}

/**
 * Entity counts returned by processors
 */
export interface TaskDetectLabelsEntityCounts {
  labelEntityCount: number;
  labelTrackCount: number;
  labelClipCount: number;
  labelObjectCount: number;
  labelFaceCount: number;
  labelPersonCount: number;
  labelSpeechCount: number;
  labelSegmentCount: number;
  labelShotCount: number;
  // Optional: only produced by the SPEAKER_TRANSCRIPTION step; the GCVI step
  // outputs predate it and are left untouched.
  labelSpeakerCount?: number;
  // Optional: only produced by the TEXT_DETECTION step (same reasoning).
  labelTextCount?: number;
}

/**
 * Output for UPLOAD_TO_GCS step
 */
export interface TaskDetectLabelsUploadToGcsStepOutput {
  gcsUri: string;
  uploaded: boolean;
  alreadyExists: boolean;
}

/**
 * Output for LABEL_DETECTION step
 */
export interface TaskDetectLabelsLabelDetectionStepOutput extends TaskDetectLabelsBaseStepOutput {
  counts: {
    segmentLabelCount: number;
    shotLabelCount: number;
    shotCount: number;
  } & TaskDetectLabelsEntityCounts;
}

/**
 * Output for OBJECT_TRACKING step
 */
export interface TaskDetectLabelsObjectTrackingStepOutput extends TaskDetectLabelsBaseStepOutput {
  counts: {
    objectCount: number;
    objectTrackCount: number;
  } & TaskDetectLabelsEntityCounts;
}

/**
 * Output for FACE_DETECTION step
 */
export interface TaskDetectLabelsFaceDetectionStepOutput extends TaskDetectLabelsBaseStepOutput {
  counts: {
    faceCount: number;
    faceTrackCount: number;
  } & TaskDetectLabelsEntityCounts;
}

/**
 * Output for PERSON_DETECTION step
 */
export interface TaskDetectLabelsPersonDetectionStepOutput extends TaskDetectLabelsBaseStepOutput {
  counts: {
    personCount: number;
    personTrackCount: number;
  } & TaskDetectLabelsEntityCounts;
}

/**
 * Output for TEXT_DETECTION step
 */
export interface TaskDetectLabelsTextDetectionStepOutput extends TaskDetectLabelsBaseStepOutput {
  counts: {
    textCount: number;
    textTrackCount: number;
  } & TaskDetectLabelsEntityCounts;
}

/**
 * Output for SPEECH_TRANSCRIPTION step
 */
export interface TaskDetectLabelsSpeechTranscriptionStepOutput extends TaskDetectLabelsBaseStepOutput {
  counts: {
    transcriptLength: number;
    wordCount: number;
  } & TaskDetectLabelsEntityCounts;
}

/**
 * Output for SPEAKER_TRANSCRIPTION step
 */
export interface TaskDetectLabelsSpeakerTranscriptionStepOutput extends TaskDetectLabelsBaseStepOutput {
  counts: {
    transcriptLength: number;
    wordCount: number;
    speakerCount: number;
  } & TaskDetectLabelsEntityCounts;
}

/**
 * Union type for all detect labels step outputs
 */
export type TaskDetectLabelsResult =
  | TaskDetectLabelsUploadToGcsStepOutput
  | TaskDetectLabelsLabelDetectionStepOutput
  | TaskDetectLabelsObjectTrackingStepOutput
  | TaskDetectLabelsFaceDetectionStepOutput
  | TaskDetectLabelsPersonDetectionStepOutput
  | TaskDetectLabelsTextDetectionStepOutput
  | TaskDetectLabelsSpeechTranscriptionStepOutput
  | TaskDetectLabelsSpeakerTranscriptionStepOutput;
