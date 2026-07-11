'use client';

import React, { useRef, useEffect, useState } from 'react';
import pb from '@/lib/pocketbase-client';
import {
  findActiveClip,
  getClipSegments,
  sourceTimeAtCompositeOffset,
  windowCompositeSegments,
  type Media,
  type PlaybackTrack,
  type TimelineClip,
} from '@project/shared';

// Proxy URL cache shared across track players (media id → URL, null if no proxy)
const proxyUrlCache = new Map<string, Promise<string | null>>();

function getProxyUrl(
  mediaId: string,
  expandedMedia?: Media
): Promise<string | null> {
  const cached = proxyUrlCache.get(mediaId);
  if (cached) return cached;

  const promise = (async () => {
    const media =
      expandedMedia ??
      ((await pb.collection('Media').getOne(mediaId)) as unknown as Media);
    if (!media.proxyFileRef) return null;
    const fileRef = await pb.collection('Files').getOne(media.proxyFileRef);
    return pb.files.getURL(fileRef, (fileRef as { file: string }).file);
  })().catch((err) => {
    console.error('Failed to load video source:', err);
    proxyUrlCache.delete(mediaId);
    return null;
  });

  proxyUrlCache.set(mediaId, promise);
  return promise;
}

interface TrackVideoProps {
  track: PlaybackTrack;
  zIndex: number;
  currentTime: number;
  isPlaying: boolean;
  muted: boolean;
}

/**
 * One <video> element for a single track, synced to the shared timeline
 * clock. Shows the clip active at the playhead on this track; hidden (but
 * kept mounted, to avoid reload churn) when the playhead is in a gap.
 */
export function TrackVideo({
  track,
  zIndex,
  currentTime,
  isPlaying,
  muted,
}: TrackVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);

  const active = findActiveClip(track.mediaClips, currentTime);
  const activeMediaId = active?.clip.MediaRef ?? null;
  const expandedMedia = active
    ? (active.clip as TimelineClip & { expand?: { MediaRef?: Media } }).expand
        ?.MediaRef
    : undefined;

  // Resolve the proxy URL when the active media changes. When the playhead
  // is in a gap (no active clip) the last src stays loaded but hidden.
  useEffect(() => {
    if (!activeMediaId) return;
    let cancelled = false;
    getProxyUrl(activeMediaId, expandedMedia).then((url) => {
      if (!cancelled) setVideoSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [activeMediaId, expandedMedia]);

  // Sync video time and playback state with the shared timeline clock
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!active || !videoSrc) {
      if (!video.paused) video.pause();
      return;
    }

    // Composite clips play their edit list back-to-back: map the timeline
    // offset through the segments — windowed by the clip's start/end trim —
    // so cut and trimmed content is skipped, matching the render. Plain
    // clips map linearly from the trim window.
    const offset = currentTime - active.globalStart;
    const segments = getClipSegments(active.clip);
    const localTime =
      segments && segments.length > 0
        ? sourceTimeAtCompositeOffset(
            windowCompositeSegments(
              segments,
              active.clip.start,
              active.clip.end
            ),
            offset
          )
        : offset + active.clip.start;

    // Only seek if the difference is significant to avoid jitter
    if (Math.abs(video.currentTime - localTime) > 0.3) {
      video.currentTime = localTime;
    }

    if (isPlaying && video.paused) {
      video.play().catch(() => {}); // Ignore play errors
    } else if (!isPlaying && !video.paused) {
      video.pause();
    }
  }, [currentTime, active, videoSrc, isPlaying]);

  // Apply track volume
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.volume = track.volume;
  }, [track.volume, videoSrc]);

  if (!videoSrc) return null;

  const visible = !!active;

  return (
    <video
      ref={videoRef}
      src={videoSrc}
      className="absolute inset-0 w-full h-full object-contain"
      style={{
        zIndex,
        opacity: track.opacity,
        visibility: visible ? 'visible' : 'hidden',
      }}
      muted={muted || track.isMuted}
      playsInline
      preload="auto"
    />
  );
}
