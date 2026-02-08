import type { TimelineClip } from '@project/shared';

/**
 * Calculates the visual position and width of a clip on the timeline.
 *
 * Positioning logic:
 * - If clip.timelineStart is defined: absolute positioning at that time offset
 * - Otherwise: sequential positioning after all preceding clips on the same track
 *
 * @param clip - The timeline clip to position
 * @param precedingClips - Array of clips that come before this clip on the same track (in order)
 * @param pixelsPerSecond - The timeline zoom level (pixels per second)
 * @returns Object with left position (pixels from timeline start) and width (pixels)
 */
export function calculateClipPosition(
  clip: TimelineClip,
  precedingClips: TimelineClip[],
  pixelsPerSecond: number
): { left: number; width: number } {
  const duration = clip.end - clip.start;
  const width = duration * pixelsPerSecond;

  // Absolute positioning if timelineStart is defined
  if (clip.timelineStart !== undefined && clip.timelineStart !== null) {
    return {
      left: clip.timelineStart * pixelsPerSecond,
      width,
    };
  }

  // Sequential positioning (fallback)
  // Accumulate the durations of all preceding clips
  const accumulatedTime = precedingClips.reduce(
    (sum, c) => sum + (c.end - c.start),
    0
  );

  return {
    left: accumulatedTime * pixelsPerSecond,
    width,
  };
}
