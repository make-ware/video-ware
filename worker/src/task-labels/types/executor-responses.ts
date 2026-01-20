/**
 * Executor Response Types
 *
 * Response types for all five GCVI API executors.
 * These types define the normalized data returned from GCVI API calls.
 */

/**
 * Bounding box coordinates (normalized 0-1 range)
 */
export interface BoundingBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Time segment with start and end times
 */
export interface TimeSegment {
  startTime: number; // seconds (float)
  endTime: number; // seconds (float)
  confidence?: number;
}

/**
 * Label Detection Response
 *
 * Response from LABEL_DETECTION and SHOT_CHANGE_DETECTION features.
 */
export interface LabelDetectionResponse {
  segmentLabels: Array<{
    entity: string;
    confidence: number;
    segments: TimeSegment[];
  }>;
  shotLabels: Array<{
    entity: string;
    confidence: number;
    segments: TimeSegment[];
  }>;
  shots: Array<{
    startTime: number;
    endTime: number;
  }>;
}

/**
 * Object frame with bounding box and confidence
 */
export interface ObjectFrame {
  timeOffset: number; // seconds (float)
  boundingBox: BoundingBox;
  confidence: number;
}

/**
 * Object Tracking Response
 *
 * Response from OBJECT_TRACKING feature.
 */
export interface ObjectTrackingResponse {
  objects: Array<{
    entity: string;
    trackId: string;
    confidence: number;
    frames: ObjectFrame[];
  }>;
}

/**
 * Face attributes detected in a frame
 * Likelihood values are typically "VERY_UNLIKELY", "UNLIKELY", "POSSIBLE", "LIKELY", "VERY_LIKELY"
 */
export interface FaceAttributes {
  joyLikelihood?: string;
  sorrowLikelihood?: string;
  angerLikelihood?: string;
  surpriseLikelihood?: string;
  underExposedLikelihood?: string;
  blurredLikelihood?: string;
  headwearLikelihood?: string;
  lookingAtCameraLikelihood?: string;
}

/**
 * Face frame with bounding box, confidence, and attributes
 */
export interface FaceFrame {
  timeOffset: number; // seconds (float)
  boundingBox: BoundingBox;
  confidence: number;
  attributes?: FaceAttributes;
}

/**
 * Face Detection Response
 *
 * Response from FACE_DETECTION feature.
 */
export interface FaceDetectionResponse {
  faces: Array<{
    trackId: string;
    faceId?: string;
    thumbnail?: string; // base64
    frames: FaceFrame[];
  }>;
}

/**
 * Person attributes detected in a frame
 */
export interface PersonAttributes {
  upperClothingColor?: string;
  lowerClothingColor?: string;
}

/**
 * Pose landmark with position and confidence
 */
export interface PoseLandmark {
  type: string; // e.g., "NOSE", "LEFT_EYE", "RIGHT_SHOULDER"
  position: {
    x: number;
    y: number;
    z: number;
  };
  confidence: number;
}

/**
 * Person frame with bounding box, confidence, attributes, and landmarks
 */
export interface PersonFrame {
  timeOffset: number; // seconds (float)
  boundingBox: BoundingBox;
  confidence: number;
  attributes?: PersonAttributes;
  landmarks?: PoseLandmark[];
}

/**
 * Person Detection Response
 *
 * Response from PERSON_DETECTION feature.
 */
export interface PersonDetectionResponse {
  persons: Array<{
    trackId: string;
    frames: PersonFrame[];
  }>;
}

/**
 * Transcribed word with timing information
 */
export interface TranscribedWord {
  word: string;
  startTime: number; // seconds (float)
  endTime: number; // seconds (float)
  confidence: number;
  speakerTag?: number;
}

/**
 * Speech Transcription Response
 *
 * Response from SPEECH_TRANSCRIPTION feature.
 */
export interface SpeechTranscriptionResponse {
  transcript: string;
  confidence: number;
  words: TranscribedWord[];
  languageCode: string;
}

/**
 * Union type for all executor responses
 */
export type ExecutorResponse =
  | LabelDetectionResponse
  | ObjectTrackingResponse
  | FaceDetectionResponse
  | PersonDetectionResponse
  | SpeechTranscriptionResponse;
