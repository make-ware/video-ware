/**
 * Centralized Type Definitions
 *
 * This file re-exports all types from a single location for easy importing.
 * All workflow step input/output types, executor responses, and normalizer types
 * are available through this index.
 */

// Step Input Types
export type {
  BaseStepInput,
  LabelDetectionStepInput,
  ObjectTrackingStepInput,
  FaceDetectionStepInput,
  PersonDetectionStepInput,
  SpeechTranscriptionStepInput,
} from './step-inputs';

// Step Output Types
export type {
  BaseStepOutput,
  EntityCounts,
  LabelDetectionStepOutput,
  ObjectTrackingStepOutput,
  FaceDetectionStepOutput,
  PersonDetectionStepOutput,
  SpeechTranscriptionStepOutput,
  StepOutput,
} from './step-outputs';

// Executor Response Types
export type {
  BoundingBox,
  TimeSegment,
  LabelDetectionResponse,
  ObjectFrame,
  ObjectTrackingResponse,
  FaceAttributes,
  FaceFrame,
  FaceDetectionResponse,
  PersonAttributes,
  PoseLandmark,
  PersonFrame,
  PersonDetectionResponse,
  TranscribedWord,
  SpeechTranscriptionResponse,
  ExecutorResponse,
} from './executor-responses';

// Normalizer Input Types
export type { NormalizerInput, ExtractResponse } from './normalizer-inputs';

// Normalizer Output Types
export type {
  LabelEntityData,
  LabelFaceData,
  LabelSpeechData,
  KeyframeData,
  LabelTrackData,
  LabelClipData,
  LabelObjectData,
  LabelSegmentData,
  LabelShotData,
  LabelPersonData,
  LabelMediaData,
  NormalizerOutput,
} from './normalizer-outputs';
