import { describe, it, expect } from 'vitest';
import {
  getActiveCue,
  getCaptionTextAtTime,
  cuesFromWords,
  cuesFromTranscripts,
  splitTextIntoCues,
  clampCuesToWindow,
  SINGLE_LINE_MAX_CHARS,
} from '../captions';
import type { CaptionCue } from '../../types/captions';

const cues: CaptionCue[] = [
  { text: 'Hello', start: 0, end: 1 },
  { text: 'world', start: 1, end: 2.5 },
  { text: 'goodbye', start: 3, end: 4 },
];

describe('getActiveCue', () => {
  it('returns the cue covering the given time', () => {
    expect(getActiveCue(cues, 0.5)?.text).toBe('Hello');
    expect(getActiveCue(cues, 1)?.text).toBe('world');
    expect(getActiveCue(cues, 3.9)?.text).toBe('goodbye');
  });

  it('returns null in gaps and outside the cue range', () => {
    expect(getActiveCue(cues, 2.7)).toBeNull();
    expect(getActiveCue(cues, 4)).toBeNull();
    expect(getActiveCue(cues, -1)).toBeNull();
  });

  it('returns null for empty or missing cues', () => {
    expect(getActiveCue([], 1)).toBeNull();
    expect(getActiveCue(undefined, 1)).toBeNull();
  });
});

describe('getCaptionTextAtTime', () => {
  it('returns the full text for captions without cues', () => {
    expect(getCaptionTextAtTime({ text: 'Static' }, 10)).toBe('Static');
    expect(getCaptionTextAtTime({ text: 'Static', cues: [] }, 0)).toBe(
      'Static'
    );
  });

  it('returns the active cue text for animated captions', () => {
    expect(getCaptionTextAtTime({ text: 'fallback', cues }, 1.5)).toBe('world');
  });

  it('returns empty string between cues', () => {
    expect(getCaptionTextAtTime({ text: 'fallback', cues }, 2.7)).toBe('');
  });
});

describe('cuesFromWords', () => {
  const words = [
    { word: 'The', startTime: 10, endTime: 10.2, confidence: 0.9 },
    { word: 'quick', startTime: 10.2, endTime: 10.5, confidence: 0.9 },
    { word: 'brown', startTime: 10.6, endTime: 11, confidence: 0.9 },
    { word: 'fox', startTime: 11, endTime: 11.4, confidence: 0.9 },
  ];

  it('groups words into a single cue when limits allow', () => {
    const result = cuesFromWords(words);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      text: 'The quick brown fox',
      start: 10,
      end: 11.4,
    });
  });

  it('re-bases timestamps using the offset', () => {
    const result = cuesFromWords(words, { offset: 10 });
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBeCloseTo(1.4);
  });

  it('splits cues at the word limit and extends ends to the next start', () => {
    const result = cuesFromWords(words, { maxWords: 2, offset: 10 });
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('The quick');
    expect(result[1].text).toBe('brown fox');
    // first cue extends to the second cue's start (0.6) instead of 0.5
    expect(result[0].end).toBeCloseTo(0.6);
  });

  it('splits cues at the character limit', () => {
    const result = cuesFromWords(words, { maxChars: 9 });
    expect(result.map((c) => c.text)).toEqual(['The quick', 'brown fox']);
  });
});

describe('cuesFromTranscripts', () => {
  const longSentence =
    'If I can have you turn the camera around so we can all see the welder';

  it('chunks word timings into single-line cues in absolute media time', () => {
    const transcript = {
      transcript: longSentence,
      start: 2,
      end: 8,
      words: longSentence.split(' ').map((word, i) => ({
        word,
        startTime: 2 + i * 0.3,
        endTime: 2 + (i + 1) * 0.3,
        confidence: 0.9,
      })),
    };

    const result = cuesFromTranscripts([transcript]);

    expect(result.length).toBeGreaterThan(1);
    // Every cue fits on one line and times stay in media time (>= 2)
    for (const cue of result) {
      expect(cue.text.length).toBeLessThanOrEqual(SINGLE_LINE_MAX_CHARS);
      expect(cue.start).toBeGreaterThanOrEqual(2);
    }
    // Reassembling the cues recovers the original sentence
    expect(result.map((c) => c.text).join(' ')).toBe(longSentence);
  });

  it('falls back to splitting the transcript blob when words are missing', () => {
    const result = cuesFromTranscripts([
      { transcript: 'one two three four five six seven', start: 0, end: 4 },
    ]);

    expect(result.length).toBeGreaterThan(0);
    for (const cue of result) {
      expect(cue.text.length).toBeLessThanOrEqual(SINGLE_LINE_MAX_CHARS);
      expect(cue.start).toBeGreaterThanOrEqual(0);
      expect(cue.end).toBeLessThanOrEqual(4);
    }
    expect(result.map((c) => c.text).join(' ')).toBe(
      'one two three four five six seven'
    );
  });

  it('filters words to the source window before chunking into cues', () => {
    const transcript = {
      transcript: 'zero one two three four five',
      start: 0,
      end: 6,
      words: ['zero', 'one', 'two', 'three', 'four', 'five'].map((word, i) => ({
        word,
        startTime: i,
        endTime: i + 1,
        confidence: 0.9,
      })),
    };

    const result = cuesFromTranscripts([transcript], {
      windowStart: 2,
      windowEnd: 4,
    });

    // Only words audible inside [2, 4) survive — never the whole overlapping
    // cue's text, so trimmed-out speech can't leak into a trimmed clip.
    expect(result).toEqual([{ text: 'two three', start: 2, end: 4 }]);
  });

  it('includes words that straddle the window edges (partially audible)', () => {
    const result = cuesFromTranscripts(
      [
        {
          transcript: 'early edge late',
          start: 0,
          end: 30,
          words: [
            { word: 'early', startTime: 0, endTime: 1, confidence: 0.9 },
            { word: 'edge', startTime: 9.5, endTime: 10.5, confidence: 0.9 },
            { word: 'late', startTime: 20, endTime: 21, confidence: 0.9 },
          ],
        },
      ],
      { windowStart: 10, windowEnd: 20 }
    );

    expect(result.map((c) => c.text)).toEqual(['edge']);
  });

  it('does not let cues extended across silence leak into a later window', () => {
    // Words end at 2s, next speech starts at 8s: the anti-flicker extension
    // stretches the first cue to 8s. A window covering only the silence
    // (4–6s) must still produce no cues.
    const transcript = {
      transcript: 'hello there again',
      start: 0,
      end: 10,
      words: [
        { word: 'hello', startTime: 0, endTime: 1, confidence: 0.9 },
        { word: 'there', startTime: 1, endTime: 2, confidence: 0.9 },
        { word: 'again', startTime: 8, endTime: 9, confidence: 0.9 },
      ],
    };

    expect(
      cuesFromTranscripts([transcript], { windowStart: 4, windowEnd: 6 })
    ).toEqual([]);
  });

  it('window-filters estimated timings on the no-words fallback path', () => {
    // 6 words spread evenly across 0–6s → 1s per word estimate
    const result = cuesFromTranscripts(
      [{ transcript: 'zero one two three four five', start: 0, end: 6 }],
      { windowStart: 2, windowEnd: 4 }
    );

    expect(result).toEqual([{ text: 'two three', start: 2, end: 4 }]);
  });

  it('flattens and sorts cues across multiple records by start time', () => {
    const result = cuesFromTranscripts([
      {
        transcript: 'later',
        start: 10,
        end: 11,
        words: [{ word: 'later', startTime: 10, endTime: 11, confidence: 1 }],
      },
      {
        transcript: 'earlier',
        start: 1,
        end: 2,
        words: [{ word: 'earlier', startTime: 1, endTime: 2, confidence: 1 }],
      },
    ]);

    expect(result.map((c) => c.text)).toEqual(['earlier', 'later']);
  });
});

describe('splitTextIntoCues', () => {
  it('creates one cue per line spread across the duration', () => {
    const result = splitTextIntoCues('One\nTwo\nThree', 6);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ text: 'One', start: 0, end: 2 });
    expect(result[2]).toEqual({ text: 'Three', start: 4, end: 6 });
  });

  it('falls back to sentence splitting for single-line text', () => {
    const result = splitTextIntoCues('Hi there. How are you?', 4);
    expect(result.map((c) => c.text)).toEqual(['Hi there.', 'How are you?']);
  });

  it('returns empty for empty text or zero duration', () => {
    expect(splitTextIntoCues('', 5)).toEqual([]);
    expect(splitTextIntoCues('Hello', 0)).toEqual([]);
  });
});

describe('clampCuesToWindow', () => {
  it('drops cues outside the window and re-bases the rest', () => {
    const result = clampCuesToWindow(cues, 1, 3.5);
    expect(result).toEqual([
      { text: 'world', start: 0, end: 1.5 },
      { text: 'goodbye', start: 2, end: 2.5 },
    ]);
  });

  it('clips cues that straddle the window edges', () => {
    const result = clampCuesToWindow(cues, 0.5, 2);
    expect(result).toEqual([
      { text: 'Hello', start: 0, end: 0.5 },
      { text: 'world', start: 0.5, end: 1.5 },
    ]);
  });

  it('handles missing cues', () => {
    expect(clampCuesToWindow(undefined, 0, 5)).toEqual([]);
  });
});
