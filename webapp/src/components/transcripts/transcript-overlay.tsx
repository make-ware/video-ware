import React, { useMemo } from 'react';
import {
  cuesFromTranscripts,
  DEFAULT_CAPTION_STYLE,
  type LabelSpeech,
} from '@project/shared';
import { CaptionOverlay } from '@/components/captions';

interface TranscriptOverlayProps {
  transcripts: LabelSpeech[];
  currentTime: number;
  isVisible: boolean;
  className?: string;
  /**
   * Source-media window (seconds) to restrict words to — pass a trimmed
   * clip's [start, end] so speech cut out of the clip never shows. Omit to
   * caption the whole media (media-detail playback).
   */
  windowStart?: number;
  windowEnd?: number;
}

/**
 * Renders LabelSpeech transcripts as timed, single-line captions over the
 * media player. Word-level timings are chunked into one-line cues
 * (`cuesFromTranscripts`) and drawn through the shared `CaptionOverlay`, so the
 * preview matches the burned-in render exactly — never more than one line.
 *
 * Cues are in absolute media time; `currentTime` is the media playback time, so
 * the overlay resolves the active cue directly without re-basing.
 */
export function TranscriptOverlay({
  transcripts,
  currentTime,
  isVisible,
  className,
  windowStart,
  windowEnd,
}: TranscriptOverlayProps) {
  const cues = useMemo(
    () => cuesFromTranscripts(transcripts, { windowStart, windowEnd }),
    [transcripts, windowStart, windowEnd]
  );

  if (!isVisible || cues.length === 0) return null;

  return (
    <CaptionOverlay
      className={className}
      text=""
      cues={cues}
      style={DEFAULT_CAPTION_STYLE}
      currentTime={currentTime}
    />
  );
}
