/**
 * Time utilities for clip and timeline operations
 *
 * All time values are stored as seconds (floating-point) internally.
 * TimeOffset format is used for editList generation with integer seconds and nanoseconds.
 */

import type { TimeOffset } from '../types/video-ware';
import { MediaType } from '../enums';

/**
 * Convert seconds (float) to TimeOffset format
 *
 * @param seconds - Time in seconds (can be fractional)
 * @returns TimeOffset object with integer seconds and nanos
 *
 * @example
 * toTimeOffset(1.5) // { seconds: 1, nanos: 500000000 }
 * toTimeOffset(0) // { seconds: 0, nanos: 0 }
 * toTimeOffset(59.999999999) // { seconds: 59, nanos: 999999999 }
 */
export function toTimeOffset(seconds: number): TimeOffset {
  const wholeSecs = Math.floor(seconds);
  const fractionalPart = seconds - wholeSecs;
  const nanos = Math.round(fractionalPart * 1_000_000_000);

  return {
    seconds: wholeSecs,
    nanos: Math.min(nanos, 999_999_999), // clamp to valid range
  };
}

/**
 * Convert TimeOffset format to seconds (float)
 *
 * @param offset - TimeOffset object
 * @returns Time in seconds (float)
 *
 * @example
 * fromTimeOffset({ seconds: 1, nanos: 500000000 }) // 1.5
 * fromTimeOffset({ seconds: 0, nanos: 0 }) // 0
 */
export function fromTimeOffset(offset: TimeOffset): number {
  return offset.seconds + offset.nanos / 1_000_000_000;
}

/**
 * Validate that a time range is valid
 *
 * @param start - Start time in seconds
 * @param end - End time in seconds
 * @param mediaDuration - Total duration of the media in seconds
 * @param mediaType - Optional media type to allow infinite duration for images
 * @returns true if the range is valid, false otherwise
 *
 * Valid range requirements:
 * - start >= 0
 * - start < end
 * - end <= mediaDuration (unless mediaType is 'image' or mediaDuration is 0)
 *
 * @example
 * validateTimeRange(0, 10, 60) // true
 * validateTimeRange(10, 5, 60) // false (start >= end)
 * validateTimeRange(-1, 10, 60) // false (start < 0)
 * validateTimeRange(0, 70, 60) // false (end > mediaDuration)
 * validateTimeRange(0, 70, 5, 'image') // true
 */
export function validateTimeRange(
  start: number,
  end: number,
  mediaDuration: number,
  mediaType?: string
): boolean {
  // Images can be infinitely extended
  if (mediaType === MediaType.IMAGE) {
    return start >= 0 && start < end;
  }

  // If media duration is 0, we allow any positive duration (fallback for unknown types/legacy)
  if (mediaDuration === 0) {
    return start >= 0 && start < end;
  }

  return start >= 0 && start < end && end <= mediaDuration;
}

/**
 * Calculate duration from start and end times
 *
 * @param start - Start time in seconds
 * @param end - End time in seconds
 * @returns Duration in seconds
 *
 * @example
 * calculateDuration(0, 10) // 10
 * calculateDuration(5.5, 10.5) // 5
 */
export function calculateDuration(start: number, end: number): number {
  return end - start;
}
