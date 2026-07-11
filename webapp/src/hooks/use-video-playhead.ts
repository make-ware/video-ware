'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Track and control a <video> element's playhead.
 *
 * Attach `registerVideo` as the element's ref. The mounted node is tracked in
 * state so effects (re)bind exactly when it mounts/unmounts — players usually
 * live inside a dialog portal, so the element can appear *after* `src` is
 * already known; keying listener setup on `src` alone misses that mount. While
 * playing, the time updates via requestAnimationFrame for a smooth playhead
 * (`timeupdate` alone only fires ~4x/sec).
 */
export function useVideoPlayhead(initialPlayhead?: number) {
  const [currentVideoTime, setCurrentVideoTime] = useState(
    initialPlayhead ?? 0
  );
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const registerVideo = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    setVideoEl((prev) => (prev === node ? prev : node));
  }, []);

  useEffect(() => {
    const video = videoEl;
    if (!video) return;

    let raf = 0;
    const sync = () => setCurrentVideoTime(video.currentTime);
    const tick = () => {
      sync();
      raf = requestAnimationFrame(tick);
    };
    const startLoop = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const stopLoop = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      sync();
    };

    video.addEventListener('play', startLoop);
    video.addEventListener('playing', startLoop);
    video.addEventListener('pause', stopLoop);
    video.addEventListener('ended', stopLoop);
    video.addEventListener('seeked', sync);
    video.addEventListener('timeupdate', sync);

    // Initialize immediately and start the loop if already playing.
    sync();
    if (!video.paused) startLoop();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      video.removeEventListener('play', startLoop);
      video.removeEventListener('playing', startLoop);
      video.removeEventListener('pause', stopLoop);
      video.removeEventListener('ended', stopLoop);
      video.removeEventListener('seeked', sync);
      video.removeEventListener('timeupdate', sync);
    };
  }, [videoEl]);

  // Seek to initialPlayhead once metadata is available
  useEffect(() => {
    if (initialPlayhead === undefined || !videoEl) return;
    // Mutate through the ref (not the state value) to keep the assignment off
    // a useState-derived object; `videoEl` above is the mount trigger.
    const video = videoRef.current;
    if (!video) return;

    const seek = () => {
      try {
        video.currentTime = initialPlayhead;
      } catch {
        // seeking can fail if metadata isn't loaded yet
      }
    };

    if (video.readyState >= 1) {
      seek();
    } else {
      video.addEventListener('loadedmetadata', seek, { once: true });
      return () => video.removeEventListener('loadedmetadata', seek);
    }
  }, [initialPlayhead, videoEl]);

  const handleScrub = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    try {
      video.currentTime = time;
    } catch {
      // seeking can fail if metadata isn't loaded yet
    }
  }, []);

  return { currentVideoTime, videoRef, registerVideo, handleScrub };
}
