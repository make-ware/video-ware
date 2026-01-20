/**
 * Track generation utilities for timeline-to-render conversion
 *
 * Generates the tracks array for render tasks from timeline clips.
 */

import type { TimelineTrack, TimelineSegment } from '../types/task-contracts';
import type { TimelineClip } from '../schema/timeline-clip';

/**
 * Validation result for validation
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validation error details
 */
export interface ValidationError {
  code: string;
  message: string;
  itemId?: string;
  itemType?: 'timeline' | 'timelineClip' | 'mediaClip' | 'media';
  field?: string;
  expected?: unknown;
  actual?: unknown;
}

/**
 * Generate Tracks from timeline clips
 *
 * Converts TimelineClip records into a multi-track structure suitable for rendering.
 * Currently maps all clips to a single video track (Layer 0).
 * Future updates can separate tracks based on clip metadata (e.g. audio clips, overlay clips).
 *
 * @param timelineClips - Array of TimelineClip records (should be sorted by order)
 * @returns Array of TimelineTrack objects
 */
export function generateTracks(timelineClips: TimelineClip[]): TimelineTrack[] {
  // We assume all clips are sequential segments.
  // We generate one video track (Layer 0) and one audio track (Layer 0).

  const videoSegments: TimelineSegment[] = timelineClips.map((clip) => ({
    id: clip.id,
    assetId: clip.MediaRef,
    type: 'video',
    time: {
      start: 0, // Placeholder, will be set below
      duration: clip.end - clip.start,
      sourceStart: clip.start,
    },
  }));

  const audioSegments: TimelineSegment[] = timelineClips.map((clip) => ({
    id: `${clip.id}-audio`,
    assetId: clip.MediaRef,
    type: 'audio',
    time: {
      start: 0, // Placeholder, will be set below
      duration: clip.end - clip.start,
      sourceStart: clip.start,
    },
    audio: {
      volume: 1.0,
    },
  }));

  // Calculate timeline start times for sequential playback
  let currentTimelineTime = 0;
  const positionedVideoSegments = videoSegments.map((seg) => {
    const duration = seg.time.duration;
    const positionedSeg = {
      ...seg,
      time: {
        ...seg.time,
        start: currentTimelineTime,
      },
    };
    currentTimelineTime += duration;
    return positionedSeg;
  });

  // Reset for audio track to ensure same positioning
  currentTimelineTime = 0;
  const positionedAudioSegments = audioSegments.map((seg) => {
    const duration = seg.time.duration;
    const positionedSeg = {
      ...seg,
      time: {
        ...seg.time,
        start: currentTimelineTime,
      },
    };
    currentTimelineTime += duration;
    return positionedSeg;
  });

  const videoTrack: TimelineTrack = {
    id: 'main-video-track',
    type: 'video',
    layer: 0,
    segments: positionedVideoSegments,
  };

  const audioTrack: TimelineTrack = {
    id: 'main-audio-track',
    type: 'audio',
    layer: 0,
    segments: positionedAudioSegments,
  };

  return [videoTrack, audioTrack];
}

/**
 * Validate a TimeOffset object
 *
 * @param offset - TimeOffset to validate
 * @param context - Context string for error messages
 * @param field - Field name for error messages
 * @returns Array of validation errors (empty if valid)
 */
export function validateTimeOffset(
  offset: unknown,
  context: string,
  field: string
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!offset || typeof offset !== 'object') {
    errors.push({
      code: 'INVALID_TIME_OFFSET',
      message: `${context} has invalid ${field}`,
      field,
      actual: offset,
    });
    return errors;
  }

  // Type guard: check if offset has required properties
  if (!('seconds' in offset) || !('nanos' in offset)) {
    errors.push({
      code: 'INVALID_TIME_OFFSET',
      message: `${context} has invalid ${field} (missing required properties)`,
      field,
      actual: offset,
    });
    return errors;
  }

  // Validate seconds
  if (typeof offset.seconds !== 'number') {
    errors.push({
      code: 'INVALID_SECONDS_TYPE',
      message: `${context} ${field}.seconds is not a number`,
      field: `${field}.seconds`,
      actual: offset.seconds,
    });
  } else if (!Number.isInteger(offset.seconds)) {
    errors.push({
      code: 'INVALID_SECONDS_INTEGER',
      message: `${context} ${field}.seconds is not an integer`,
      field: `${field}.seconds`,
      actual: offset.seconds,
    });
  } else if (offset.seconds < 0) {
    errors.push({
      code: 'INVALID_SECONDS_NEGATIVE',
      message: `${context} ${field}.seconds is negative`,
      field: `${field}.seconds`,
      expected: '>= 0',
      actual: offset.seconds,
    });
  }

  // Validate nanos
  if (typeof offset.nanos !== 'number') {
    errors.push({
      code: 'INVALID_NANOS_TYPE',
      message: `${context} ${field}.nanos is not a number`,
      field: `${field}.nanos`,
      actual: offset.nanos,
    });
  } else if (!Number.isInteger(offset.nanos)) {
    errors.push({
      code: 'INVALID_NANOS_INTEGER',
      message: `${context} ${field}.nanos is not an integer`,
      field: `${field}.nanos`,
      actual: offset.nanos,
    });
  } else if (offset.nanos < 0 || offset.nanos > 999_999_999) {
    errors.push({
      code: 'INVALID_NANOS_RANGE',
      message: `${context} ${field}.nanos is out of range [0, 999999999]`,
      field: `${field}.nanos`,
      expected: '[0, 999999999]',
      actual: offset.nanos,
    });
  }

  return errors;
}
