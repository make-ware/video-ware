import {
  TaskDetectLabelsBaseStep,
  TaskDetectLabelsLabelDetectionStep,
  TaskDetectLabelsObjectTrackingStep,
  TaskDetectLabelsFaceDetectionStep,
  TaskDetectLabelsPersonDetectionStep,
  TaskDetectLabelsSpeechTranscriptionStep,
} from '@project/shared/jobs';

/**
 * Base input type shared by all step processors
 */
export type BaseStepInput = TaskDetectLabelsBaseStep;

/**
 * Label Detection Step Input
 *
 * Processes video for label detection and shot change detection.
 * Features: LABEL_DETECTION, SHOT_CHANGE_DETECTION
 */
export type LabelDetectionStepInput = TaskDetectLabelsLabelDetectionStep;

/**
 * Object Tracking Step Input
 *
 * Processes video for object tracking with keyframe data.
 * Features: OBJECT_TRACKING
 */
export type ObjectTrackingStepInput = TaskDetectLabelsObjectTrackingStep;

/**
 * Face Detection Step Input
 *
 * Processes video for face detection with attributes.
 * Features: FACE_DETECTION
 */
export type FaceDetectionStepInput = TaskDetectLabelsFaceDetectionStep;

/**
 * Person Detection Step Input
 *
 * Processes video for person detection with landmarks and attributes.
 * Features: PERSON_DETECTION
 */
export type PersonDetectionStepInput = TaskDetectLabelsPersonDetectionStep;

/**
 * Speech Transcription Step Input
 *
 * Processes video for speech transcription.
 * Features: SPEECH_TRANSCRIPTION
 */
export type SpeechTranscriptionStepInput =
  TaskDetectLabelsSpeechTranscriptionStep;
