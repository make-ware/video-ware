/**
 * Labels job types
 * Defines step types, input types, and output types for label detection jobs
 */

/**
 * Detect labels step type enum
 */
export enum DetectLabelsStepType {
  UPLOAD_TO_GCS = 'labels:upload_to_gcs',
  LABEL_DETECTION = 'labels:label_detection',
  OBJECT_TRACKING = 'labels:object_tracking',
  FACE_DETECTION = 'labels:face_detection',
  PERSON_DETECTION = 'labels:person_detection',
  SPEECH_TRANSCRIPTION = 'labels:speech_transcription',
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
 * Union type for all detect labels step inputs
 */
export type TaskDetectLabelsInput =
  | TaskDetectLabelsUploadToGcsStep
  | TaskDetectLabelsLabelDetectionStep
  | TaskDetectLabelsObjectTrackingStep
  | TaskDetectLabelsFaceDetectionStep
  | TaskDetectLabelsPersonDetectionStep
  | TaskDetectLabelsSpeechTranscriptionStep;

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
 * Output for SPEECH_TRANSCRIPTION step
 */
export interface TaskDetectLabelsSpeechTranscriptionStepOutput extends TaskDetectLabelsBaseStepOutput {
  counts: {
    transcriptLength: number;
    wordCount: number;
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
  | TaskDetectLabelsSpeechTranscriptionStepOutput;
