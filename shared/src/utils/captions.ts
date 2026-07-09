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
 * Conservative character budget for a single on-screen caption line. The
 * overlay (whitespace-pre) and the renderer (ffmpeg drawtext) both refuse to
 * wrap, so chunking transcript words to this width keeps preview and render
 * identical and never spills past one line at typical caption font sizes.
 */
export const SINGLE_LINE_MAX_CHARS = 32;

/** Minimal shape needed to derive cues from a transcript record (LabelSpeech). */
export interface TranscriptLike {
  /** LabelSpeech.words (stored as JSON, so loosely typed) */
  words?: unknown;
  /** Full transcript text, used as a fallback when word timings are absent */
  transcript?: string;
  /** Segment start in media time (seconds) */
  start: number;
  /** Segment end in media time (seconds) */
  end: number;
}

/**
 * Estimate per-word timings for a transcript blob by spreading its words
 * evenly across the record's [start, end] window, in absolute media time.
 * Fallback for transcripts that lack word-level timing, so they flow through
 * the same window-filter + chunking path as real timings.
 */
function estimateWordTimings(
  text: string,
  start: number,
  end: number
): SpeechWordTiming[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const per = Math.max(end - start, 0) / words.length;
  return words.map((word, i) => ({
    word,
    startTime: start + i * per,
    endTime: start + (i + 1) * per,
  }));
}

export interface CuesFromTranscriptsOptions {
  /** Maximum characters per cue line (default SINGLE_LINE_MAX_CHARS) */
  maxChars?: number;
  /**
   * Source-media window (seconds) the cues are for, e.g. a trimmed clip's
   * [start, end]. Words are filtered to the window BEFORE being chunked into
   * cues, so speech that was trimmed out never appears — clamping pre-built
   * cues instead would keep the full text of any cue that merely overlaps
   * the boundary. A word straddling an edge counts as inside (it is partially
   * audible). Cue times stay absolute; pair with clampCuesToWindow to re-base.
   */
  windowStart?: number;
  windowEnd?: number;
}

/**
 * Derive single-line caption cues from one or more transcript records.
 *
 * Each record's word timings are chunked into single-line phrase cues (falling
 * back to evenly-estimated timings when words are missing). Cues stay in
 * absolute media time — re-basing/clamping to a trimmed clip window is done
 * later with clampCuesToWindow. This is the shared bridge used by the
 * media-detail overlay and the render edit-list so both show the same lines.
 */
export function cuesFromTranscripts(
  transcripts: TranscriptLike[],
  options: CuesFromTranscriptsOptions = {}
): CaptionCue[] {
  const maxChars = options.maxChars ?? SINGLE_LINE_MAX_CHARS;
  const windowStart = options.windowStart ?? -Infinity;
  const windowEnd = options.windowEnd ?? Infinity;
  const cues: CaptionCue[] = [];

  for (const t of transcripts) {
    const rawWords = Array.isArray(t.words)
      ? (t.words as SpeechWordTiming[])
      : [];
    const hasTimings =
      rawWords.length > 0 &&
      rawWords.every(
        (w) =>
          typeof w?.word === 'string' &&
          typeof w?.startTime === 'number' &&
          typeof w?.endTime === 'number'
      );

    let words: SpeechWordTiming[];
    if (hasTimings) {
      words = rawWords;
    } else if (t.transcript && t.transcript.trim()) {
      words = estimateWordTimings(t.transcript, t.start, t.end);
    } else {
      continue;
    }

    const visible = words.filter(
      (w) => w.endTime > windowStart && w.startTime < windowEnd
    );
    cues.push(...cuesFromWords(visible, { maxChars, offset: 0 }));
  }

  cues.sort((a, b) => a.start - b.start);
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
