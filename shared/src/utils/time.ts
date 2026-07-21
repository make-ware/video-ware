/**
 * Time utilities for clip and timeline operations
 *
 * All time values are stored as seconds (floating-point) internally.
 */

import { MediaType } from '../enums';

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
