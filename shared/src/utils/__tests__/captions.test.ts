import { describe, it, expect } from 'vitest';
import {
  getActiveCue,
  getCaptionTextAtTime,
  cuesFromWords,
  splitTextIntoCues,
  clampCuesToWindow,
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
