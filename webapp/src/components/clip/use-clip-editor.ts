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
}

export function useClipEditor({
  media,
  initialStart,
  initialEnd,
  initialSegments,
  isComposite = false,
  minDuration = DEFAULT_MIN_DURATION,
}: UseClipEditorOptions) {
  const [startTime, setStartTime] = useState(initialStart);
  const [endTime, setEndTime] = useState(initialEnd);
  const [segments, setSegments] = useState<Segment[]>(initialSegments ?? []);
  const [currentVideoTime, setCurrentVideoTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

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

  // Track video current time
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handleTimeUpdate = () => setCurrentVideoTime(video.currentTime);
    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => video.removeEventListener('timeupdate', handleTimeUpdate);
  }, []);

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
