/**
 * Edit-list-aware transcript trimming: reduce utterance rows (LabelSpeaker /
 * LabelSpeech) to the words a clip actually plays, word by word, through the
 * clip's WINDOWED edit list. Words sitting wholly inside a cut gap are
 * dropped; an utterance spanning a cut splits into per-segment parts so the
 * text reads the way the cut plays. Browser-safe and presentation-free —
 * consumed by the CLI transcript command, reusable by the webapp.
 *
 * All times are float seconds. `clipStart`/`clipEnd` are clip-effective
 * offsets (0 = the clip's first visible frame), mapped with
 * compositeOffsetAtSourceTime over the same windowed segments the player and
 * render use, so they line up with `timelineStart + offset` for placed clips.
 */

import {
  compositeOffsetAtSourceTime,
  type CompositeSegment,
} from './composite-utils.js';
import { roundToMs } from './segment-edits.js';

/** Normalized word — both stored word shapes flatten to this. */
export interface TranscriptWord {
  text: string;
  /** Source-media seconds. */
  start: number;
  end: number;
  /** LabelSpeaker words carry the provider speaker id. */
  speakerId?: string;
  /** LabelSpeech words carry a per-word confidence. */
  confidence?: number;
}

/** Minimal utterance shape both label rows satisfy (words is raw JSON). */
export interface UtteranceLike {
  id: string;
  /** Full utterance text — the estimation fallback when words are absent. */
  transcript?: string;
  /** Source-media seconds. */
  start: number;
  end: number;
  words?: unknown;
  /** LabelSpeaker rows: provider speaker id ("speaker_0"). */
  speakerId?: string;
  /** LabelSpeech rows: provider speaker tag. */
  speakerTag?: number;
  confidence?: number;
}

/** LabelSpeaker word shape: {text, start, end, speakerId?}. */
interface SpeakerShapedWord {
  text: string;
  start: number;
  end: number;
  speakerId?: string;
}

/** LabelSpeech word shape: {word, startTime, endTime, confidence?}. */
interface SpeechShapedWord {
  word: string;
  startTime: number;
  endTime: number;
  confidence?: number;
}

const isSpeakerShaped = (w: unknown): w is SpeakerShapedWord =>
  typeof (w as SpeakerShapedWord)?.text === 'string' &&
  typeof (w as SpeakerShapedWord)?.start === 'number' &&
  typeof (w as SpeakerShapedWord)?.end === 'number';

const isSpeechShaped = (w: unknown): w is SpeechShapedWord =>
  typeof (w as SpeechShapedWord)?.word === 'string' &&
  typeof (w as SpeechShapedWord)?.startTime === 'number' &&
  typeof (w as SpeechShapedWord)?.endTime === 'number';

/**
 * Normalize an utterance's stored words to TranscriptWord[]. Recognizes both
 * the LabelSpeaker shape ({text,start,end}) and the LabelSpeech shape
 * ({word,startTime,endTime}); when neither fits, spreads the transcript text
 * evenly across [start,end] (mirroring captions.ts estimateWordTimings) and
 * flags the result — cut filtering on estimated timings is approximate.
 */
export function normalizeUtteranceWords(u: UtteranceLike): {
  words: TranscriptWord[];
  estimated: boolean;
} {
  const raw = Array.isArray(u.words) ? u.words : [];
  if (raw.length > 0 && raw.every(isSpeakerShaped)) {
    return {
      words: raw.map((w) => ({
        text: w.text,
        start: w.start,
        end: w.end,
        ...(w.speakerId !== undefined ? { speakerId: w.speakerId } : {}),
      })),
      estimated: false,
    };
  }
  if (raw.length > 0 && raw.every(isSpeechShaped)) {
    return {
      words: raw.map((w) => ({
        text: w.word,
        start: w.startTime,
        end: w.endTime,
        ...(w.confidence !== undefined ? { confidence: w.confidence } : {}),
      })),
      estimated: false,
    };
  }
  const text = u.transcript?.trim();
  if (!text) return { words: [], estimated: true };
  const tokens = text.split(/\s+/).filter(Boolean);
  const per = Math.max(u.end - u.start, 0) / tokens.length;
  return {
    words: tokens.map((token, i) => ({
      text: token,
      start: u.start + i * per,
      end: u.start + (i + 1) * per,
    })),
    estimated: true,
  };
}

/**
 * Whether [start, end] overlaps any segment. The straddler-keeps rule
 * (`end > seg.start && start < seg.end`) matches cuesFromTranscripts, so the
 * transcript command, caption cues, and the render agree on boundary words.
 */
export function overlapsSegments(
  start: number,
  end: number,
  segments: CompositeSegment[]
): boolean {
  return segments.some((s) => end > s.start && start < s.end);
}

/** One per-kept-segment run of an utterance. */
export interface TranscriptPart {
  /** Index into the windowed edit list the part's words play from. */
  segmentIndex: number;
  /** Kept words joined with spaces. */
  text: string;
  /** Range covered by the kept words (source seconds). */
  sourceStart: number;
  sourceEnd: number;
  /** Clip-effective offsets (0 = the clip's first visible frame). */
  clipStart: number;
  clipEnd: number;
  words: TranscriptWord[];
}

export interface ClipUtterance {
  id: string;
  speakerId?: string;
  speakerTag?: number;
  confidence?: number;
  /** Kept text; parts split by a cut are joined with "[cut N.Ns]" markers. */
  text: string;
  /** Range of the kept words only (source seconds). */
  sourceStart: number;
  sourceEnd: number;
  clipStart: number;
  clipEnd: number;
  parts: TranscriptPart[];
  /** Words dropped because they sit wholly inside cut gaps / outside the window. */
  omittedWords: number;
  /** True when word timings were estimated (cut filtering is approximate). */
  estimatedTimings: boolean;
}

export interface ClipTranscript {
  utterances: ClipUtterance[];
  totals: {
    /** Utterances with at least one kept word. */
    utterances: number;
    keptWords: number;
    /** Includes the words of utterances hidden entirely by cuts. */
    omittedWords: number;
    /** Utterances whose every word fell in a gap — dropped entirely. */
    droppedUtterances: number;
  };
}

/** "[cut 40.0s]" — source seconds removed between two kept parts. */
function cutMarker(seconds: number): string {
  return `[cut ${seconds.toFixed(1)}s]`;
}

/**
 * Trim utterances to a clip's windowed edit list at word level.
 *
 * `segments` must already be windowed by the clip's [start, end]
 * (windowCompositeSegments) and normalized — the same list playback uses. A
 * word is kept iff it overlaps a kept segment (straddlers count); a word
 * overlapping two segments is assigned to the first. Utterances with zero
 * kept words are dropped and counted.
 */
export function buildClipTranscript(
  utterances: UtteranceLike[],
  segments: CompositeSegment[]
): ClipTranscript {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const result: ClipUtterance[] = [];
  let keptWords = 0;
  let omittedTotal = 0;
  let droppedUtterances = 0;

  for (const u of utterances) {
    const { words, estimated } = normalizeUtteranceWords(u);
    const bySegment = new Map<number, TranscriptWord[]>();
    let omitted = 0;

    for (const word of words) {
      const index = sorted.findIndex(
        (s) => word.end > s.start && word.start < s.end
      );
      if (index === -1) {
        omitted++;
        continue;
      }
      const bucket = bySegment.get(index);
      if (bucket) bucket.push(word);
      else bySegment.set(index, [word]);
    }

    omittedTotal += omitted;
    if (bySegment.size === 0) {
      if (words.length > 0) droppedUtterances++;
      continue;
    }

    const parts: TranscriptPart[] = [...bySegment.entries()]
      .sort(([a], [b]) => a - b)
      .map(([segmentIndex, segWords]) => {
        const sourceStart = Math.min(...segWords.map((w) => w.start));
        const sourceEnd = Math.max(...segWords.map((w) => w.end));
        return {
          segmentIndex,
          text: segWords.map((w) => w.text).join(' '),
          sourceStart: roundToMs(sourceStart),
          sourceEnd: roundToMs(sourceEnd),
          clipStart: roundToMs(
            compositeOffsetAtSourceTime(sorted, sourceStart)
          ),
          clipEnd: roundToMs(compositeOffsetAtSourceTime(sorted, sourceEnd)),
          words: segWords,
        };
      });

    const pieces: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        // Total source removed between the two parts' segments (sums the
        // gaps across any wordless segments in between).
        let removed = 0;
        for (
          let k = parts[i - 1].segmentIndex;
          k < parts[i].segmentIndex;
          k++
        ) {
          removed += Math.max(0, sorted[k + 1].start - sorted[k].end);
        }
        pieces.push(cutMarker(removed));
      }
      pieces.push(parts[i].text);
    }

    keptWords += words.length - omitted;
    result.push({
      id: u.id,
      ...(u.speakerId !== undefined ? { speakerId: u.speakerId } : {}),
      ...(u.speakerTag !== undefined ? { speakerTag: u.speakerTag } : {}),
      ...(u.confidence !== undefined ? { confidence: u.confidence } : {}),
      text: pieces.join(' '),
      sourceStart: parts[0].sourceStart,
      sourceEnd: parts[parts.length - 1].sourceEnd,
      clipStart: parts[0].clipStart,
      clipEnd: parts[parts.length - 1].clipEnd,
      parts,
      omittedWords: omitted,
      estimatedTimings: estimated,
    });
  }

  return {
    utterances: result,
    totals: {
      utterances: result.length,
      keptWords,
      omittedWords: omittedTotal,
      droppedUtterances,
    },
  };
}
