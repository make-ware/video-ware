import {
  TaskDetectLabelsBaseStepOutput,
  TaskDetectLabelsEntityCounts,
  TaskDetectLabelsLabelDetectionStepOutput,
  TaskDetectLabelsObjectTrackingStepOutput,
  TaskDetectLabelsFaceDetectionStepOutput,
  TaskDetectLabelsPersonDetectionStepOutput,
  TaskDetectLabelsTextDetectionStepOutput,
  TaskDetectLabelsSpeechTranscriptionStepOutput,
  TaskDetectLabelsSpeakerTranscriptionStepOutput,
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
 * Text Detection Step Output
 *
 * Results from on-screen text (OCR) processing.
 */
export type TextDetectionStepOutput = TaskDetectLabelsTextDetectionStepOutput;

/**
 * Speech Transcription Step Output
 *
 * Results from speech transcription processing.
 */
export type SpeechTranscriptionStepOutput =
  TaskDetectLabelsSpeechTranscriptionStepOutput;

/**
 * Speaker Transcription Step Output
 *
 * Results from speaker-diarized STT processing.
 */
export type SpeakerTranscriptionStepOutput =
  TaskDetectLabelsSpeakerTranscriptionStepOutput;

/**
 * Union type for all step outputs
 */
export type StepOutput =
  | LabelDetectionStepOutput
  | ObjectTrackingStepOutput
  | FaceDetectionStepOutput
  | PersonDetectionStepOutput
  | TextDetectionStepOutput
  | SpeechTranscriptionStepOutput
  | SpeakerTranscriptionStepOutput;
