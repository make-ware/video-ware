/**
 * Caption cue utilities
 *
 * Shared between the webapp (live preview overlays) and the worker
 * (render-time drawtext generation). All cue times are in seconds,
 * relative to the caption's own start.
 */

import type { CaptionCue } from '../types/captions';

/** Word timing entry as stored on LabelSpeech.words */
export interface SpeechWordTiming {
  word: string;
  startTime: number;
  endTime: number;
  confidence?: number;
  speakerTag?: number;
}

/**
 * Find the cue active at a given caption-local time.
 * Returns null when no cue covers the time (caller may fall back to
 * the caption's static text, or show nothing between cues).
 */
export function getActiveCue(
  cues: CaptionCue[] | undefined,
  time: number
): CaptionCue | null {
  if (!cues || cues.length === 0) return null;
  for (let i = cues.length - 1; i >= 0; i--) {
    const cue = cues[i];
    if (time >= cue.start && time < cue.end) {
      return cue;
    }
  }
  return null;
}

/**
 * Resolve the text to display at a caption-local time.
 * Captions without cues are static: the full text shows for the whole
 * duration. Captions with cues show only the active cue's text.
 */
export function getCaptionTextAtTime(
  caption: { text: string; cues?: CaptionCue[] | null },
  time: number
): string {
  const cues = caption.cues ?? undefined;
  if (!cues || cues.length === 0) return caption.text;
  return getActiveCue(cues, time)?.text ?? '';
}

export interface CuesFromWordsOptions {
  /** Maximum characters per cue line (default 42, a common subtitle width) */
  maxChars?: number;
  /** Maximum words per cue (default 8) */
  maxWords?: number;
  /**
   * Subtracted from every word timestamp so cues become relative to the
   * caption start (pass the speech segment's start time).
   */
  offset?: number;
}

/**
 * Group word-level transcript timings (LabelSpeech.words) into caption cues.
 * This is the bridge from transcript/TTS data to the shared caption model:
 * consecutive words are merged into a cue until a length limit is reached.
 */
export function cuesFromWords(
  words: SpeechWordTiming[],
  options: CuesFromWordsOptions = {}
): CaptionCue[] {
  const { maxChars = 42, maxWords = 8, offset = 0 } = options;
  const cues: CaptionCue[] = [];

  let current: { words: string[]; start: number; end: number } | null = null;

  for (const word of words) {
    const text = word.word.trim();
    if (!text) continue;

    const start = Math.max(0, word.startTime - offset);
    const end = Math.max(start, word.endTime - offset);

    if (current) {
      const candidate = [...current.words, text].join(' ');
      if (candidate.length > maxChars || current.words.length >= maxWords) {
        cues.push({
          text: current.words.join(' '),
          start: current.start,
          end: current.end,
        });
        current = null;
      }
    }

    if (!current) {
      current = { words: [text], start, end };
    } else {
      current.words.push(text);
      current.end = end;
    }
  }

  if (current) {
    cues.push({
      text: current.words.join(' '),
      start: current.start,
      end: current.end,
    });
  }

  // Extend each cue until the next one starts so text doesn't flicker
  // during inter-word silence.
  for (let i = 0; i < cues.length - 1; i++) {
    cues[i].end = Math.max(cues[i].end, cues[i + 1].start);
  }

  return cues;
}

/**
 * Split text into evenly-timed cues across a duration.
 * Lines (or sentences when the text is a single line) become one cue each.
 * Used by the caption editor's "animate text" helper.
 */
export function splitTextIntoCues(
  text: string,
  duration: number,
  options: { minCueDuration?: number } = {}
): CaptionCue[] {
  const { minCueDuration = 0.5 } = options;

  let parts = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    parts = text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (parts.length === 0 || duration <= 0) return [];

  const cueDuration = Math.max(duration / parts.length, minCueDuration);

  return parts.map((part, i) => ({
    text: part,
    start: Math.min(i * cueDuration, duration),
    end: Math.min((i + 1) * cueDuration, duration),
  }));
}

/**
 * Clamp cues to a trim window and re-base them to the window start.
 * Used when a caption clip is trimmed on the timeline: only the cues that
 * overlap [windowStart, windowEnd) survive, shifted so 0 is the clip start.
 */
export function clampCuesToWindow(
  cues: CaptionCue[] | undefined,
  windowStart: number,
  windowEnd: number
): CaptionCue[] {
  if (!cues || cues.length === 0) return [];
  const result: CaptionCue[] = [];
  for (const cue of cues) {
    const start = Math.max(cue.start, windowStart);
    const end = Math.min(cue.end, windowEnd);
    if (end <= start) continue;
    result.push({
      text: cue.text,
      start: start - windowStart,
      end: end - windowStart,
    });
  }
  return result;
}
