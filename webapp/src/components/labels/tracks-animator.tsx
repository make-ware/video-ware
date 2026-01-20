'use client';

import React, { useMemo } from 'react';
import { type Media, type LabelTrack } from '@project/shared';
import { FilmstripViewer } from '@/components/filmstrip/filmstrip-viewer';
import { useTimeAnimation } from '@/hooks/use-time-animation';

interface Keyframe {
  t: number; // time offset
  bbox: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  confidence: number;
}

interface TracksAnimatorProps {
  media: Media;
  track: LabelTrack;
  className?: string;
}

export function TracksAnimator({
  media,
  track,
  className,
}: TracksAnimatorProps) {
  // Sort keyframes by time (t) and validate structure
  // Convert keyframe times to relative times (relative to track.start)
  const sortedKeyframes = useMemo(() => {
    const kf = (track.keyframes as unknown as Keyframe[]) || [];
    // Filter out invalid keyframes, convert to relative times, and sort
    return kf
      .filter((kf) => {
        // Validate keyframe structure
        return (
          kf &&
          typeof kf.t === 'number' &&
          kf.bbox &&
          typeof kf.bbox.left === 'number' &&
          typeof kf.bbox.top === 'number' &&
          typeof kf.bbox.right === 'number' &&
          typeof kf.bbox.bottom === 'number'
        );
      })
      .map((kf) => ({
        ...kf,
        // Convert absolute time to relative time (relative to track.start)
        // Keyframes may be stored as absolute times, but we need relative times
        t: kf.t - track.start,
      }))
      .sort((a, b) => a.t - b.t);
  }, [track.keyframes, track.start]);

  // Animate time for filmstrip viewer
  const currentTime = useTimeAnimation({
    start: track.start,
    end: track.end,
    enabled: true,
    loop: true,
    speed: 4, // Playback at 3 x speed
    fps: 4, // Poll data at 1 fps
  });

  // Find the current bounding box based on currentTime
  const currentBox = useMemo(() => {
    if (sortedKeyframes.length === 0) return null;

    // Adjust currentTime relative to track.start
    const relativeTime = currentTime - track.start;

    // Clamp relativeTime to track bounds (0 to track duration)
    // This ensures we always show something if we're within the track
    const clampedRelativeTime = Math.max(
      0,
      Math.min(relativeTime, track.end - track.start)
    );

    // Find the bounding keyframes for interpolation
    let prevIdx = -1;
    for (let i = 0; i < sortedKeyframes.length; i++) {
      if (sortedKeyframes[i].t <= clampedRelativeTime) {
        prevIdx = i;
      } else {
        break;
      }
    }

    // Handle edge cases
    if (prevIdx === -1) {
      // Before first keyframe - use first keyframe
      // This ensures boxes are visible even if animation starts slightly before first keyframe
      return sortedKeyframes[0]?.bbox || null;
    }

    const prev = sortedKeyframes[prevIdx];
    const next = sortedKeyframes[prevIdx + 1];

    if (!next) {
      // After last keyframe - use last keyframe
      // This ensures boxes stay visible until the end of the track
      return prev.bbox;
    }

    // Interpolate between prev and next
    const dt = next.t - prev.t;
    if (dt <= 0 || !isFinite(dt)) {
      // Invalid time difference, use previous keyframe
      return prev.bbox;
    }

    const t = (clampedRelativeTime - prev.t) / dt;
    const clampedT = Math.max(0, Math.min(1, t));

    // Linear interpolation with validation
    const interpolated = {
      left: prev.bbox.left + (next.bbox.left - prev.bbox.left) * clampedT,
      top: prev.bbox.top + (next.bbox.top - prev.bbox.top) * clampedT,
      right: prev.bbox.right + (next.bbox.right - prev.bbox.right) * clampedT,
      bottom:
        prev.bbox.bottom + (next.bbox.bottom - prev.bbox.bottom) * clampedT,
    };

    // Validate interpolated values are finite and reasonable
    if (
      !isFinite(interpolated.left) ||
      !isFinite(interpolated.top) ||
      !isFinite(interpolated.right) ||
      !isFinite(interpolated.bottom) ||
      interpolated.right <= interpolated.left ||
      interpolated.bottom <= interpolated.top
    ) {
      // Fallback to previous keyframe if interpolation is invalid
      return prev.bbox;
    }

    return interpolated;
  }, [sortedKeyframes, currentTime, track.start, track.end]);

  return (
    <div
      className={`relative aspect-video bg-black rounded-lg overflow-hidden ${className || ''}`}
    >
      {/* Filmstrip viewer for video preview with autoplay */}
      <FilmstripViewer
        media={media}
        currentTime={currentTime}
        className="absolute inset-0 w-full h-full"
      />

      {/* Overlay: Show current bounding box (interpolated) */}
      {currentBox && (
        <div className="absolute inset-0 pointer-events-none">
          <div
            className="absolute border-2 border-red-500"
            style={{
              left: `${Math.max(0, Math.min(100, currentBox.left * 100))}%`,
              top: `${Math.max(0, Math.min(100, currentBox.top * 100))}%`,
              width: `${Math.max(0, Math.min(100, (currentBox.right - currentBox.left) * 100))}%`,
              height: `${Math.max(0, Math.min(100, (currentBox.bottom - currentBox.top) * 100))}%`,
            }}
          />
        </div>
      )}
    </div>
  );
}
