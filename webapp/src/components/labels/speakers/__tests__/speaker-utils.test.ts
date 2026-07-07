import { describe, it, expect } from 'vitest';
import {
  prettySpeakerId,
  speakerNameOf,
  speakerEntityName,
  speakerTranscriptLabelFor,
  deriveSpeakerSummaries,
  formatDiarizedTranscript,
  deriveMergedSpeakerMeta,
  speakerBadgeClass,
  speakerDotClass,
  type SpeakerUtterance,
} from '../speaker-utils';

/** Attach a linked-Entity expand (LabelTrackRef.EntityRef) to an utterance. */
function withEntity(u: SpeakerUtterance, name: string): SpeakerUtterance {
  u.expand = {
    ...u.expand,
    LabelTrackRef: { expand: { EntityRef: { name } } } as never,
  };
  return u;
}

function utterance(
  fields: Partial<SpeakerUtterance> & { speakerId: string; transcript: string }
): SpeakerUtterance {
  return {
    id: `id-${fields.speakerId}-${fields.start ?? 0}`,
    WorkspaceRef: 'ws1',
    MediaRef: 'media1',
    start: 0,
    end: 1,
    duration: 1,
    confidence: 0.9,
    words: [],
    speakerHash: 'hash',
    ...fields,
  } as unknown as SpeakerUtterance;
}

describe('prettySpeakerId', () => {
  it('maps provider ids to 1-based names', () => {
    expect(prettySpeakerId('speaker_0')).toBe('Speaker 1');
    expect(prettySpeakerId('speaker_11')).toBe('Speaker 12');
  });

  it('passes unrecognized ids through', () => {
    expect(prettySpeakerId('unknown')).toBe('unknown');
    expect(prettySpeakerId('speaker_x')).toBe('speaker_x');
  });
});

describe('speakerNameOf', () => {
  it('prefers the expanded LabelEntity canonical name', () => {
    const u = utterance({ speakerId: 'speaker_0', transcript: 'hi' });
    u.expand = {
      LabelEntityRef: { canonicalName: 'Alice' } as never,
    };
    expect(speakerNameOf(u)).toBe('Alice');
  });

  it('falls back to the prettified provider id', () => {
    const u = utterance({ speakerId: 'speaker_1', transcript: 'hi' });
    expect(speakerNameOf(u)).toBe('Speaker 2');
  });
});

describe('speakerEntityName / speakerTranscriptLabelFor', () => {
  it('resolves the linked entity name from the track expand', () => {
    const u = withEntity(
      utterance({ speakerId: 'speaker_0', transcript: 'hi' }),
      'Erik'
    );
    expect(speakerEntityName(u)).toBe('Erik');
    expect(speakerTranscriptLabelFor(u)).toBe('Speaker 1 (Erik)');
  });

  it('falls back to just the pretty id when no entity is linked', () => {
    const u = utterance({ speakerId: 'speaker_1', transcript: 'hi' });
    expect(speakerEntityName(u)).toBeNull();
    expect(speakerTranscriptLabelFor(u)).toBe('Speaker 2');
  });
});

describe('deriveSpeakerSummaries', () => {
  it('aggregates counts and durations per speaker in first-appearance order', () => {
    const summaries = deriveSpeakerSummaries([
      utterance({
        speakerId: 'speaker_1',
        transcript: 'a',
        start: 0,
        end: 2,
        duration: 2,
      }),
      utterance({
        speakerId: 'speaker_0',
        transcript: 'b',
        start: 2,
        end: 3,
        duration: 1,
      }),
      utterance({
        speakerId: 'speaker_1',
        transcript: 'c',
        start: 3,
        end: 6,
        duration: 3,
      }),
    ]);

    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({
      speakerId: 'speaker_1',
      name: 'Speaker 2',
      utteranceCount: 2,
      totalDuration: 5,
      colorIndex: 0,
    });
    expect(summaries[1]).toMatchObject({
      speakerId: 'speaker_0',
      utteranceCount: 1,
      colorIndex: 1,
    });
  });

  it('returns an empty list for no utterances', () => {
    expect(deriveSpeakerSummaries([])).toEqual([]);
  });
});

describe('speaker colors', () => {
  it('wraps around the palette', () => {
    expect(speakerBadgeClass(0)).toBe(speakerBadgeClass(8));
    expect(speakerDotClass(1)).toBe(speakerDotClass(9));
  });
});

describe('formatDiarizedTranscript', () => {
  it('merges consecutive utterances by the same speaker', () => {
    const text = formatDiarizedTranscript([
      utterance({ speakerId: 'speaker_0', transcript: 'Hello there.' }),
      utterance({ speakerId: 'speaker_0', transcript: 'How are you?' }),
      utterance({ speakerId: 'speaker_1', transcript: 'Fine, thanks.' }),
      utterance({ speakerId: 'speaker_0', transcript: 'Great.' }),
    ]);

    expect(text).toBe(
      'Speaker 1: Hello there. How are you?\n\n' +
        'Speaker 2: Fine, thanks.\n\n' +
        'Speaker 1: Great.'
    );
  });

  it('returns empty string for no utterances', () => {
    expect(formatDiarizedTranscript([])).toBe('');
  });

  it('tags speakers with the linked entity only when given the resolver', () => {
    const utterances = [
      withEntity(
        utterance({ speakerId: 'speaker_0', transcript: 'Hello there.' }),
        'Erik'
      ),
      utterance({ speakerId: 'speaker_1', transcript: 'Fine, thanks.' }),
    ];

    // Default resolver: never leaks the live entity name into (persisted) text.
    expect(formatDiarizedTranscript(utterances)).toBe(
      'Speaker 1: Hello there.\n\nSpeaker 2: Fine, thanks.'
    );

    // Entity-aware resolver: parenthesizes identified speakers.
    expect(
      formatDiarizedTranscript(utterances, speakerTranscriptLabelFor)
    ).toBe('Speaker 1 (Erik): Hello there.\n\nSpeaker 2: Fine, thanks.');
  });
});

describe('deriveMergedSpeakerMeta', () => {
  it('titles single-speaker selections with the speaker name', () => {
    const meta = deriveMergedSpeakerMeta([
      utterance({
        speakerId: 'speaker_0',
        transcript: 'First words here',
        start: 0,
      }),
      utterance({
        speakerId: 'speaker_0',
        transcript: 'more words',
        start: 5,
      }),
    ]);
    expect(meta.label).toBe('Speaker 1: First words here (2 utterances)');
    expect(meta.description).toBe('Speaker 1: First words here more words');
  });

  it('titles mixed selections as a conversation', () => {
    const meta = deriveMergedSpeakerMeta([
      utterance({ speakerId: 'speaker_1', transcript: 'Answer', start: 5 }),
      utterance({ speakerId: 'speaker_0', transcript: 'Question', start: 0 }),
    ]);
    expect(meta.label).toBe('Conversation: Question (2 utterances)');
    expect(meta.description).toBe('Speaker 1: Question\n\nSpeaker 2: Answer');
  });
});
