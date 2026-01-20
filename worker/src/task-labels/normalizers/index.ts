/**
 * Normalizers Index
 *
 * Re-exports all normalizers from a single location for easy importing.
 *
 * Normalizers transform GCVI API responses into database entities:
 * - LabelEntity: Unique labels/entities
 * - LabelTrack: Tracked objects/persons/faces with keyframes
 * - LabelMedia: Aggregated metadata
 */

export { LabelDetectionNormalizer } from './label-detection.normalizer';
export { ObjectTrackingNormalizer } from './object-tracking.normalizer';
export { FaceDetectionNormalizer } from './face-detection.normalizer';
export { PersonDetectionNormalizer } from './person-detection.normalizer';
export { SpeechTranscriptionNormalizer } from './speech-transcription.normalizer';
