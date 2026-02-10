import { useState, useMemo, useCallback } from 'react';
import type { TimelineClip } from '@project/shared';

/**
 * Represents a snap target position on the timeline
 */
export interface SnapPosition {
  time: number;
  source: 'clip-start' | 'clip-end' | 'playhead' | 'grid';
}

/**
 * Options for the useSnap hook
 */
export interface UseSnapOptions {
  clips: TimelineClip[];
  currentTime: number;
  pixelsPerSecond: number;
  threshold?: number; // pixels, default 8
  enabled?: boolean;
}

/**
 * Result returned by the useSnap hook
 */
export interface UseSnapResult {
  snapTime: (
    candidateTime: number,
    excludeClipId?: string
  ) => {
    snapped: number;
    guide: SnapPosition | null;
  };
  activeGuides: SnapPosition[];
  clearGuides: () => void;
}

/**
 * Finds the nearest snap target within the threshold distance.
 *
 * @param candidateTime - The time position to snap (in seconds)
 * @param targets - Array of available snap targets
 * @param thresholdSeconds - Maximum distance for snapping (in seconds)
 * @returns The nearest snap target if within threshold, otherwise null
 */
export function findSnapTarget(
  candidateTime: number,
  targets: SnapPosition[],
  thresholdSeconds: number
): SnapPosition | null {
  let closest: SnapPosition | null = null;
  let minDist = Infinity;

  for (const target of targets) {
    const dist = Math.abs(candidateTime - target.time);
    if (dist < thresholdSeconds && dist < minDist) {
      minDist = dist;
      closest = target;
    }
  }

  return closest;
}

/**
 * Custom hook for managing timeline snapping behavior.
 *
 * Collects snap targets from clip edges and the playhead, then provides
 * a function to snap candidate times to the nearest target within threshold.
 *
 * @param options - Configuration options for snapping
 * @returns Snap utilities including snapTime function and active guides
 */
export function useSnap(options: UseSnapOptions): UseSnapResult {
  const {
    clips,
    currentTime,
    pixelsPerSecond,
    threshold = 8, // pixels
    enabled = true,
  } = options;

  const [activeGuides, setActiveGuides] = useState<SnapPosition[]>([]);

  // Convert pixel threshold to time threshold
  const thresholdSeconds = threshold / pixelsPerSecond;

  // Collect all snap targets from clips and playhead
  const snapTargets = useMemo(() => {
    const targets: SnapPosition[] = [];

    // Add playhead as a snap target
    targets.push({
      time: currentTime,
      source: 'playhead',
    });

    // Add clip edges as snap targets
    for (const clip of clips) {
      // Clip start position (either absolute or sequential)
      if (clip.timelineStart !== undefined && clip.timelineStart !== null) {
        targets.push({
          time: clip.timelineStart,
          source: 'clip-start',
        });
        targets.push({
          time: clip.timelineStart + (clip.end - clip.start),
          source: 'clip-end',
        });
      } else {
        // For sequential clips, we'd need preceding clips to calculate position
        // For now, we'll use the clip's start/end times directly
        // This will be refined when integrated with the full timeline context
        targets.push({
          time: clip.start,
          source: 'clip-start',
        });
        targets.push({
          time: clip.end,
          source: 'clip-end',
        });
      }
    }

    return targets;
  }, [clips, currentTime]);

  /**
   * Snaps a candidate time to the nearest target within threshold.
   *
   * @param candidateTime - The time to snap (in seconds)
   * @param excludeClipId - Optional clip ID to exclude from snapping (e.g., the clip being dragged)
   * @returns Object with snapped time and the guide to display (if any)
   */
  const snapTime = useCallback(
    (candidateTime: number, excludeClipId?: string) => {
      // If snapping is disabled, return the original time
      if (!enabled) {
        return { snapped: candidateTime, guide: null };
      }

      // Filter out targets from the excluded clip if specified
      let targets = snapTargets;
      if (excludeClipId) {
        const excludedClip = clips.find((c) => c.id === excludeClipId);
        if (excludedClip) {
          const excludedStart =
            excludedClip.timelineStart ?? excludedClip.start;
          const excludedEnd =
            excludedStart + (excludedClip.end - excludedClip.start);

          targets = snapTargets.filter(
            (t) =>
              Math.abs(t.time - excludedStart) > 0.001 &&
              Math.abs(t.time - excludedEnd) > 0.001
          );
        }
      }

      // Find the nearest snap target
      const target = findSnapTarget(candidateTime, targets, thresholdSeconds);

      if (target) {
        // Update active guides
        setActiveGuides([target]);
        return { snapped: target.time, guide: target };
      }

      // No snap target found, clear guides
      setActiveGuides([]);
      return { snapped: candidateTime, guide: null };
    },
    [enabled, snapTargets, thresholdSeconds, clips]
  );

  /**
   * Clears all active snap guides
   */
  const clearGuides = useCallback(() => {
    setActiveGuides([]);
  }, []);

  return {
    snapTime,
    activeGuides,
    clearGuides,
  };
}
