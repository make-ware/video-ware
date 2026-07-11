'use client';

import { useState, useCallback, useMemo } from 'react';
import type { Media } from '@project/shared';
import {
  MediaType,
  validateTimeRange,
  calculateEffectiveDuration,
  clampSegmentsToWindow,
  deriveClipTimes,
} from '@project/shared';
import { useVideoSource } from '@/hooks/use-video-source';
import { useVideoPlayhead } from '@/hooks/use-video-playhead';
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

/**
 * Clip editor state shared by plain and composite clips. The trim window
 * (`startTime`/`endTime`) has the same meaning for both: the clip's overall
 * in/out points. For composites the fine-tune modal owns the edit list;
 * trimming the window intersects it at save time via `effectiveSegments`
 * (the CLI's `update --start/--end` semantics) without touching the
 * `segments` state, so dragging a handle out and back loses nothing.
 */
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
  const { currentVideoTime, videoRef, registerVideo, handleScrub } =
    useVideoPlayhead(initialPlayhead);

  const { src, poster } = useVideoSource(media ?? undefined);

  const mediaDuration = media?.duration ?? 0;

  const isImage = useMemo(() => {
    if (!media) return false;
    const type = Array.isArray(media.mediaType)
      ? media.mediaType[0]
      : media.mediaType;
    return type === MediaType.IMAGE;
  }, [media]);

  // Images/legacy media have no upper time bound (validateTimeRange rule)
  const bounds = useMemo(
    () => (isImage || mediaDuration <= 0 ? {} : { mediaDuration }),
    [isImage, mediaDuration]
  );

  /**
   * The edit list intersected with the trim window — what a composite save
   * persists. Plain clips pass their (empty) list through; an empty result
   * for a composite means the window covers no segment content.
   */
  const effectiveSegments = useMemo(() => {
    if (!isComposite || segments.length === 0) return segments;
    if (startTime >= endTime) return [];
    return clampSegmentsToWindow(segments, startTime, endTime, bounds);
  }, [isComposite, segments, startTime, endTime, bounds]);

  // Derive validation error from current state (no side effects)
  const validationError = useMemo(() => {
    if (!media) return null;

    // Window checks apply to both clip kinds — the trim handles drive the
    // same start/end either way.
    if (
      !validateTimeRange(
        startTime,
        endTime,
        mediaDuration,
        isImage ? MediaType.IMAGE : undefined
      )
    ) {
      if (startTime < 0) return 'Start time cannot be negative';
      if (startTime >= endTime) return 'Start time must be less than end time';
      if (endTime > mediaDuration)
        return `End time cannot exceed media duration (${mediaDuration.toFixed(2)}s)`;
      return 'Invalid time range';
    }

    if (isComposite) {
      if (segments.length === 0) {
        return 'Composite clip must have at least one segment';
      }
      if (effectiveSegments.length === 0) {
        return 'Trim window contains no segment content';
      }
      const dur = calculateEffectiveDuration(
        startTime,
        endTime,
        effectiveSegments
      );
      if (dur < minDuration) {
        return `Effective duration must be at least ${minDuration}s`;
      }
      return null;
    }

    if (minDuration > 0 && endTime - startTime < minDuration) {
      return `Duration must be at least ${minDuration}s`;
    }
    return null;
  }, [
    startTime,
    endTime,
    segments,
    effectiveSegments,
    isComposite,
    isImage,
    media,
    mediaDuration,
    minDuration,
  ]);

  const handleTrimChange = useCallback((start: number, end: number) => {
    setStartTime(start);
    setEndTime(end);
  }, []);

  /**
   * Replace the edit list (fine-tune apply) and re-span the trim window to
   * the new segments, so the handles reflect the list they now clamp.
   */
  const applySegments = useCallback((next: Segment[]) => {
    setSegments(next);
    if (next.length > 0) {
      const times = deriveClipTimes(next);
      setStartTime(times.start);
      setEndTime(times.end);
    }
  }, []);

  const hasChanges = useMemo(() => {
    if (startTime !== initialStart || endTime !== initialEnd) return true;
    if (isComposite) {
      return JSON.stringify(segments) !== JSON.stringify(initialSegments ?? []);
    }
    return false;
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
      if (effectiveSegments.length === 0) return 0;
      return calculateEffectiveDuration(startTime, endTime, effectiveSegments);
    }
    return endTime - startTime;
  }, [isComposite, segments, effectiveSegments, startTime, endTime]);

  const canSave = !validationError;

  return {
    startTime,
    endTime,
    setStartTime,
    setEndTime,
    segments,
    setSegments,
    applySegments,
    effectiveSegments,
    isComposite,
    isImage,
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
