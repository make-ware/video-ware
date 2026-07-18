'use client';

import React, { useMemo } from 'react';
import { type Media, type LabelTrack } from '@project/shared';
import { FilmstripViewer } from '@/components/filmstrip/filmstrip-viewer';
import { useTimeAnimation } from '@/hooks/use-time-animation';
import { interpolateBbox, normalizeKeyframes } from './keyframes';

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
  const sortedKeyframes = useMemo(
    () => normalizeKeyframes(track.keyframes, track.start),
    [track.keyframes, track.start]
  );

  // Animate time for filmstrip viewer
  const currentTime = useTimeAnimation({
    start: track.start,
    end: track.end,
    enabled: true,
    loop: true,
    speed: 4, // Playback at 4x speed
    fps: 4, // Poll data at 4 fps
  });

  // Current bounding box, interpolated at the animated time (clamped to the
  // track range so a box stays visible for the whole loop).
  const currentBox = useMemo(() => {
    const relativeTime = Math.max(
      0,
      Math.min(currentTime - track.start, track.end - track.start)
    );
    return interpolateBbox(sortedKeyframes, relativeTime);
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
