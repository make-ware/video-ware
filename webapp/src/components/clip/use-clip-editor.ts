'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { Media } from '@project/shared';
import { validateTimeRange, calculateEffectiveDuration } from '@project/shared';
import { useVideoSource } from '@/hooks/use-video-source';
import type { Segment } from '@/components/timeline/segment-editor';
import type { ExpandedMedia } from '@/types/expanded-types';

const DEFAULT_MIN_DURATION = 0.5;

interface UseClipEditorOptions {
  media: Media | ExpandedMedia | null | undefined;
  initialStart: number;
  initialEnd: number;
  initialSegments?: Segment[];
  isComposite?: boolean;
  minDuration?: number;
  initialPlayhead?: number;
}

export function useClipEditor({
  media,
  initialStart,
  initialEnd,
  initialSegments,
  isComposite = false,
  minDuration = DEFAULT_MIN_DURATION,
  initialPlayhead,
}: UseClipEditorOptions) {
  const [startTime, setStartTime] = useState(initialStart);
  const [endTime, setEndTime] = useState(initialEnd);
  const [segments, setSegments] = useState<Segment[]>(initialSegments ?? []);
  const [currentVideoTime, setCurrentVideoTime] = useState(
    initialPlayhead ?? 0
  );
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // The mounted <video> node, tracked in state so effects (re)bind to it
  // exactly when it mounts/unmounts. The player lives inside the dialog's
  // portal, so the element can appear *after* `src` is already known — keying
  // listener setup on `src` alone misses that mount, leaving the timeline
  // playhead permanently out of sync with the video. A callback ref is the
  // reliable signal.
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const registerVideo = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    setVideoEl((prev) => (prev === node ? prev : node));
  }, []);

  const { src, poster } = useVideoSource(media ?? undefined);

  const mediaDuration = media?.duration ?? 0;

  // Derive validation error from current state (no side effects)
  const validationError = useMemo(() => {
    if (!media) return null;

    if (isComposite) {
      if (segments.length === 0) {
        return 'Composite clip must have at least one segment';
      }
      const dur = calculateEffectiveDuration(0, mediaDuration, segments);
      if (dur < minDuration) {
        return `Effective duration must be at least ${minDuration}s`;
      }
      return null;
    }

    if (!validateTimeRange(startTime, endTime, mediaDuration)) {
      if (startTime < 0) return 'Start time cannot be negative';
      if (startTime >= endTime) return 'Start time must be less than end time';
      if (endTime > mediaDuration)
        return `End time cannot exceed media duration (${mediaDuration.toFixed(2)}s)`;
      return 'Invalid time range';
    }
    if (minDuration > 0 && endTime - startTime < minDuration) {
      return `Duration must be at least ${minDuration}s`;
    }
    return null;
  }, [
    startTime,
    endTime,
    segments,
    isComposite,
    media,
    mediaDuration,
    minDuration,
  ]);

  // Track the video playhead. Bound to the actual <video> node (via the
  // `registerVideo` callback ref) so listeners attach exactly when the element
  // mounts and detach when it unmounts — the player lives inside the dialog's
  // portal and can mount after `src` is already known. While playing we update
  // via requestAnimationFrame for a smooth playhead; `timeupdate` alone only
  // fires ~4x/sec, which makes the indicator look laggy and out of sync.
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

  const handleTrimChange = useCallback((start: number, end: number) => {
    setStartTime(start);
    setEndTime(end);
  }, []);

  const handleScrub = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    try {
      video.currentTime = time;
    } catch {
      // seeking can fail if metadata isn't loaded yet
    }
  }, []);

  const hasChanges = useMemo(() => {
    if (isComposite) {
      return JSON.stringify(segments) !== JSON.stringify(initialSegments ?? []);
    }
    return startTime !== initialStart || endTime !== initialEnd;
  }, [
    startTime,
    endTime,
    segments,
    initialStart,
    initialEnd,
    initialSegments,
    isComposite,
  ]);

  const effectiveDuration = useMemo(() => {
    if (isComposite && segments.length > 0) {
      return calculateEffectiveDuration(0, mediaDuration, segments);
    }
    return endTime - startTime;
  }, [isComposite, segments, startTime, endTime, mediaDuration]);

  const canSave = !validationError;

  return {
    startTime,
    endTime,
    setStartTime,
    setEndTime,
    segments,
    setSegments,
    isComposite,
    currentVideoTime,
    videoRef,
    registerVideo,
    handleTrimChange,
    handleScrub,
    validationError,
    canSave,
    hasChanges,
    effectiveDuration,
    mediaDuration,
    src,
    poster,
  };
}
