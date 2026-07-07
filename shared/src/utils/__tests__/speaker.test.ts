import { describe, it, expect } from 'vitest';
import { prettySpeakerId, speakerTranscriptLabel } from '../speaker';

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

describe('speakerTranscriptLabel', () => {
  it('appends the linked entity name in parentheses', () => {
    expect(speakerTranscriptLabel('speaker_0', 'Erik')).toBe(
      'Speaker 1 (Erik)'
    );
  });

  it('falls back to the pretty id when unidentified', () => {
    expect(speakerTranscriptLabel('speaker_0')).toBe('Speaker 1');
    expect(speakerTranscriptLabel('speaker_1', null)).toBe('Speaker 2');
    expect(speakerTranscriptLabel('speaker_2', '   ')).toBe('Speaker 3');
  });

  it('does not double up when the name equals the pretty id', () => {
    expect(speakerTranscriptLabel('speaker_0', 'Speaker 1')).toBe('Speaker 1');
  });
});
