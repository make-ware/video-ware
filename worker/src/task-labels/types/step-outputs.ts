import {
  TaskDetectLabelsBaseStepOutput,
  TaskDetectLabelsEntityCounts,
  TaskDetectLabelsLabelDetectionStepOutput,
  TaskDetectLabelsObjectTrackingStepOutput,
  TaskDetectLabelsFaceDetectionStepOutput,
  TaskDetectLabelsPersonDetectionStepOutput,
  TaskDetectLabelsSpeechTranscriptionStepOutput,
} from '@project/shared/jobs';

/**
 * Base output type shared by all step processors
 */
export type BaseStepOutput = TaskDetectLabelsBaseStepOutput;

/**
 * Entity counts returned by processors
 */
export type EntityCounts = TaskDetectLabelsEntityCounts;

/**
 * Label Detection Step Output
 *
 * Results from label detection and shot change detection processing.
 */
export type LabelDetectionStepOutput = TaskDetectLabelsLabelDetectionStepOutput;

/**
 * Object Tracking Step Output
 *
 * Results from object tracking processing.
 */
export type ObjectTrackingStepOutput = TaskDetectLabelsObjectTrackingStepOutput;

/**
 * Face Detection Step Output
 *
 * Results from face detection processing.
 */
export type FaceDetectionStepOutput = TaskDetectLabelsFaceDetectionStepOutput;

/**
 * Person Detection Step Output
 *
 * Results from person detection processing.
 */
export type PersonDetectionStepOutput =
  TaskDetectLabelsPersonDetectionStepOutput;

/**
 * Speech Transcription Step Output
 *
 * Results from speech transcription processing.
 */
export type SpeechTranscriptionStepOutput =
  TaskDetectLabelsSpeechTranscriptionStepOutput;

/**
 * Union type for all step outputs
 */
export type StepOutput =
  | LabelDetectionStepOutput
  | ObjectTrackingStepOutput
  | FaceDetectionStepOutput
  | PersonDetectionStepOutput
  | SpeechTranscriptionStepOutput;
