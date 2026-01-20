// Time conversion utilities for normalizing various time formats to seconds

/**
 * Duration object format from Google APIs
 */
export interface DurationObject {
  seconds?: number | string;
  nanos?: number;
}

/**
 * Converts various time formats to seconds (float)
 * Handles:
 * - Milliseconds (number)
 * - Nanoseconds (number with 'ns' suffix or very large numbers)
 * - Duration objects ({ seconds, nanos })
 * - String formats ('123s', '123.456s')
 * - Already in seconds (number)
 */
export function toSeconds(
  time: string | number | DurationObject | undefined | null
): number {
  if (time === undefined || time === null) {
    return 0;
  }

  // Handle Duration object format
  if (typeof time === 'object' && ('seconds' in time || 'nanos' in time)) {
    const seconds = parseFloat(String(time.seconds || 0));
    const nanos = time.nanos || 0;
    return seconds + nanos / 1_000_000_000;
  }

  // Handle string formats
  if (typeof time === 'string') {
    // Remove 's' suffix if present
    const cleaned = time.replace(/s$/, '');
    const parsed = parseFloat(cleaned);

    if (isNaN(parsed)) {
      return 0;
    }

    // If the string had 's' suffix, it's already in seconds
    if (time.endsWith('s')) {
      return parsed;
    }

    // Otherwise treat as milliseconds if > 1000, else seconds
    return parsed > 1000 ? parsed / 1000 : parsed;
  }

  // Handle number formats
  if (typeof time === 'number') {
    // Nanoseconds: very large numbers (> 1 billion)
    if (time > 1_000_000_000) {
      return time / 1_000_000_000;
    }

    // Milliseconds: numbers between 1000 and 1 billion
    if (time > 1000) {
      return time / 1000;
    }

    // Already in seconds
    return time;
  }

  return 0;
}

/**
 * Converts milliseconds to seconds
 */
export function millisecondsToSeconds(ms: number): number {
  return ms / 1000;
}

/**
 * Converts nanoseconds to seconds
 */
export function nanosecondsToSeconds(ns: number): number {
  return ns / 1_000_000_000;
}

/**
 * Converts a Duration object to seconds
 */
export function durationToSeconds(duration: DurationObject): number {
  const seconds = parseFloat(String(duration.seconds || 0));
  const nanos = duration.nanos || 0;
  return seconds + nanos / 1_000_000_000;
}

/**
 * Calculates duration from start and end times
 */
export function calculateDuration(
  start: string | number | DurationObject | undefined | null,
  end: string | number | DurationObject | undefined | null
): number {
  const startSeconds = toSeconds(start);
  const endSeconds = toSeconds(end);
  return Math.max(0, endSeconds - startSeconds);
}

/**
 * Validates that start < end and returns normalized times
 */
export function normalizeTimeRange(
  start: string | number | DurationObject | undefined | null,
  end: string | number | DurationObject | undefined | null
): { start: number; end: number; duration: number } {
  const startSeconds = toSeconds(start);
  const endSeconds = toSeconds(end);

  if (startSeconds >= endSeconds) {
    throw new Error(
      `Invalid time range: start (${startSeconds}) must be less than end (${endSeconds})`
    );
  }

  return {
    start: startSeconds,
    end: endSeconds,
    duration: endSeconds - startSeconds,
  };
}
