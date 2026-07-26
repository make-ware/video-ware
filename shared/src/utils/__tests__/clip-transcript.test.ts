import { describe, it, expect } from 'vitest';
import {
  buildClipTranscript,
  normalizeUtteranceWords,
  overlapsSegments,
  type UtteranceLike,
} from '../clip-transcript.js';

const utterance = (over: Partial<UtteranceLike> & { id: string }) =>
  ({
    transcript: '',
    start: 0,
    end: 0,
    ...over,
  }) as UtteranceLike;

describe('normalizeUtteranceWords', () => {
  it('recognizes the LabelSpeaker word shape', () => {
    const { words, estimated } = normalizeUtteranceWords(
      utterance({
        id: 'u1',
        words: [
          { text: 'hello', start: 1, end: 1.4, speakerId: 'speaker_0' },
          { text: 'world', start: 1.4, end: 1.9 },
        ],
      })
    );
    expect(estimated).toBe(false);
    expect(words).toEqual([
      { text: 'hello', start: 1, end: 1.4, speakerId: 'speaker_0' },
      { text: 'world', start: 1.4, end: 1.9 },
    ]);
  });

  it('recognizes the LabelSpeech word shape', () => {
    const { words, estimated } = normalizeUtteranceWords(
      utterance({
        id: 'u1',
        words: [
          { word: 'hello', startTime: 1, endTime: 1.4, confidence: 0.9 },
          { word: 'world', startTime: 1.4, endTime: 1.9 },
        ],
      })
    );
    expect(estimated).toBe(false);
    expect(words).toEqual([
      { text: 'hello', start: 1, end: 1.4, confidence: 0.9 },
      { text: 'world', start: 1.4, end: 1.9 },
    ]);
  });

  it('estimates evenly-spread timings from the transcript when words are unusable', () => {
    const { words, estimated } = normalizeUtteranceWords(
      utterance({
        id: 'u1',
        transcript: 'one two three four',
        start: 10,
        end: 14,
        words: [{ garbage: true }],
      })
    );
    expect(estimated).toBe(true);
    expect(words).toHaveLength(4);
    expect(words[0]).toEqual({ text: 'one', start: 10, end: 11 });
    expect(words[3]).toEqual({ text: 'four', start: 13, end: 14 });
  });

  it('returns empty flagged output when there is nothing to estimate from', () => {
    const { words, estimated } = normalizeUtteranceWords(
      utterance({ id: 'u1', start: 0, end: 2 })
    );
    expect(words).toEqual([]);
    expect(estimated).toBe(true);
  });
});

describe('overlapsSegments', () => {
  const segments = [
    { start: 0, end: 10 },
    { start: 50, end: 60 },
  ];

  it('keeps straddlers and drops gap-only ranges', () => {
    expect(overlapsSegments(9.8, 10.3, segments)).toBe(true);
    expect(overlapsSegments(12, 40, segments)).toBe(false);
    expect(overlapsSegments(49.9, 50.1, segments)).toBe(true);
  });

  it('treats touching boundaries as outside (end > start is strict)', () => {
    expect(overlapsSegments(10, 12, segments)).toBe(false);
  });
});

describe('buildClipTranscript', () => {
  // The user's canonical scenario: a 40s cut in the middle of a take.
  const segments = [
    { start: 0, end: 10 },
    { start: 50, end: 60 },
  ];

  it('splits a gap-spanning utterance into parts with a cut marker', () => {
    const result = buildClipTranscript(
      [
        utterance({
          id: 'u1',
          speakerId: 'speaker_0',
          words: [
            { text: 'keep', start: 8, end: 9 },
            { text: 'this', start: 9, end: 10 },
            { text: 'umm', start: 20, end: 21 },
            { text: 'cut', start: 30, end: 31 },
            { text: 'and', start: 50, end: 51 },
            { text: 'this', start: 51, end: 52 },
          ],
        }),
      ],
      segments
    );

    expect(result.utterances).toHaveLength(1);
    const u = result.utterances[0];
    expect(u.text).toBe('keep this [cut 40.0s] and this');
    expect(u.omittedWords).toBe(2);
    expect(u.parts).toHaveLength(2);
    expect(u.parts[0].segmentIndex).toBe(0);
    expect(u.parts[0].text).toBe('keep this');
    expect(u.parts[1].segmentIndex).toBe(1);
    // Clip-time continuity: part 0 ends at the boundary offset part 1 starts.
    expect(u.parts[0].clipEnd).toBe(10);
    expect(u.parts[1].clipStart).toBe(10);
    expect(u.parts[1].clipEnd).toBe(12);
    expect(u.sourceStart).toBe(8);
    expect(u.sourceEnd).toBe(52);
    expect(result.totals).toEqual({
      utterances: 1,
      keptWords: 4,
      omittedWords: 2,
      droppedUtterances: 0,
    });
  });

  it('keeps straddling words and assigns gap-spanners to the first segment', () => {
    const result = buildClipTranscript(
      [
        utterance({
          id: 'u1',
          words: [
            // Straddles segment 0's end — partially audible, kept.
            { text: 'edge', start: 9.8, end: 10.3 },
            // Spans the whole gap (estimated-timing artifact) — first segment.
            { text: 'spanner', start: 9.9, end: 50.2 },
          ],
        }),
      ],
      segments
    );
    const u = result.utterances[0];
    expect(u.parts).toHaveLength(1);
    expect(u.parts[0].segmentIndex).toBe(0);
    expect(u.parts[0].text).toBe('edge spanner');
    expect(u.omittedWords).toBe(0);
  });

  it('drops utterances hidden entirely by the cut', () => {
    const result = buildClipTranscript(
      [
        utterance({
          id: 'gone',
          words: [
            { text: 'lost', start: 20, end: 21 },
            { text: 'forever', start: 21, end: 22 },
          ],
        }),
        utterance({
          id: 'kept',
          words: [{ text: 'here', start: 5, end: 6 }],
        }),
      ],
      segments
    );
    expect(result.utterances.map((u) => u.id)).toEqual(['kept']);
    expect(result.totals).toEqual({
      utterances: 1,
      keptWords: 1,
      omittedWords: 2,
      droppedUtterances: 1,
    });
  });

  it('passes a plain trim window through with linear clip offsets', () => {
    const result = buildClipTranscript(
      [
        utterance({
          id: 'u1',
          words: [
            { text: 'plain', start: 12, end: 13 },
            { text: 'read', start: 13, end: 14 },
          ],
        }),
      ],
      [{ start: 10, end: 20 }]
    );
    const u = result.utterances[0];
    expect(u.text).toBe('plain read');
    expect(u.clipStart).toBe(2);
    expect(u.clipEnd).toBe(4);
    expect(u.omittedWords).toBe(0);
    expect(u.estimatedTimings).toBe(false);
  });

  it('flags estimated timings and still filters through the cut', () => {
    const result = buildClipTranscript(
      [
        utterance({
          id: 'u1',
          transcript: 'one two three four five six',
          start: 0,
          end: 60,
          // no usable words -> evenly spread across [0, 60], 10s each
        }),
      ],
      segments
    );
    const u = result.utterances[0];
    expect(u.estimatedTimings).toBe(true);
    // Words 1 (0-10) and 6 (50-60) survive; 2-5 sit in the gap.
    expect(u.text).toBe('one [cut 40.0s] six');
    expect(u.omittedWords).toBe(4);
  });

  it('sums gaps across wordless segments between two parts', () => {
    const threeSegments = [
      { start: 0, end: 10 },
      { start: 20, end: 25 }, // plays, but no words land here
      { start: 40, end: 50 },
    ];
    const result = buildClipTranscript(
      [
        utterance({
          id: 'u1',
          words: [
            { text: 'first', start: 5, end: 6 },
            { text: 'last', start: 41, end: 42 },
          ],
        }),
      ],
      threeSegments
    );
    // Removed source between the parts' segments: (20-10) + (40-25) = 25s.
    expect(result.utterances[0].text).toBe('first [cut 25.0s] last');
  });
});
