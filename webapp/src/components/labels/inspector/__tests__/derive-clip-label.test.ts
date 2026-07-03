import { describe, it, expect } from 'vitest';
import { LabelType } from '@project/shared';
import type { LabelSpeech } from '@project/shared';
import type { ActualizableLabel } from '@project/shared/mutator';
import {
  deriveClipMeta,
  deriveMergedSpeechMeta,
  truncateWords,
  truncateChars,
} from '../derive-clip-label';

function fakeLabel(fields: Record<string, unknown>): ActualizableLabel {
  return {
    id: 'abcdef123456789',
    WorkspaceRef: 'ws1',
    MediaRef: 'media1',
    start: 0,
    end: 1,
    duration: 1,
    ...fields,
  } as unknown as ActualizableLabel;
}

describe('truncateWords', () => {
  it('keeps short text intact', () => {
    expect(truncateWords('hello world')).toBe('hello world');
  });

  it('truncates to 8 words with ellipsis', () => {
    expect(truncateWords('a b c d e f g h i j')).toBe('a b c d e f g h…');
  });

  it('normalizes whitespace and handles empty text', () => {
    expect(truncateWords('  a   b  ')).toBe('a b');
    expect(truncateWords('   ')).toBe('');
  });
});

describe('truncateChars', () => {
  it('truncates long text with ellipsis', () => {
    const long = 'x'.repeat(600);
    const result = truncateChars(long);
    expect(result.length).toBeLessThanOrEqual(501);
    expect(result.endsWith('…')).toBe(true);
  });

  it('keeps short text intact', () => {
    expect(truncateChars('short')).toBe('short');
  });
});

describe('deriveClipMeta', () => {
  it('capitalizes entity for object/shot/segment', () => {
    expect(
      deriveClipMeta(LabelType.OBJECT, fakeLabel({ entity: 'dog' })).label
    ).toBe('Dog');
    expect(
      deriveClipMeta(LabelType.SHOT, fakeLabel({ entity: 'outdoor' })).label
    ).toBe('Outdoor');
    expect(
      deriveClipMeta(LabelType.SEGMENT, fakeLabel({ entity: 'intro' })).label
    ).toBe('Intro');
  });

  it('falls back to a short id when entity is empty', () => {
    expect(
      deriveClipMeta(LabelType.OBJECT, fakeLabel({ entity: '' })).label
    ).toBe('Label abcdef12');
  });

  it('derives speech label from the transcript with full description', () => {
    const transcript =
      'the quick brown fox jumps over the lazy dog again and again';
    const meta = deriveClipMeta(
      LabelType.SPEECH,
      fakeLabel({ transcript, confidence: 0.9 })
    );
    expect(meta.label).toBe('the quick brown fox jumps over the lazy…');
    expect(meta.description).toBe(transcript);
  });

  it('derives text label from detected text', () => {
    const meta = deriveClipMeta(LabelType.TEXT, fakeLabel({ text: 'STOP' }));
    expect(meta.label).toBe('STOP');
    expect(meta.description).toBe('STOP');
  });

  it('uses faceId/personId with id fallback', () => {
    expect(
      deriveClipMeta(LabelType.FACE, fakeLabel({ faceId: 'f42' })).label
    ).toBe('Face f42');
    expect(deriveClipMeta(LabelType.FACE, fakeLabel({})).label).toBe(
      'Face abcdef12'
    );
    expect(
      deriveClipMeta(LabelType.PERSON, fakeLabel({ personId: 'p7' })).label
    ).toBe('Person p7');
  });
});

describe('deriveMergedSpeechMeta', () => {
  const segment = (start: number, transcript: string): LabelSpeech =>
    fakeLabel({ start, end: start + 1, transcript }) as unknown as LabelSpeech;

  it('labels with the first segment words and count', () => {
    const meta = deriveMergedSpeechMeta([
      segment(5, 'later words'),
      segment(1, 'first words here'),
    ]);
    expect(meta.label).toBe('first words here (2 segments)');
    expect(meta.description).toBe('first words here later words');
  });

  it('handles empty transcripts', () => {
    const meta = deriveMergedSpeechMeta([segment(0, '')]);
    expect(meta.label).toBe('Speech (1 segment)');
    expect(meta.description).toBeUndefined();
  });
});
