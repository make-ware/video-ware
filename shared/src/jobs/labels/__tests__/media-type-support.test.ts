import { describe, it, expect } from 'vitest';
import { LabelType, MediaType } from '../../../enums';
import {
  LABEL_JOB_TYPES,
  mediaTypeSupportsLabelType,
  mediaTypeSupportsLabelJobType,
  mediaTypeSupportsLabels,
} from '../types';

const ALL_LABEL_TYPES = Object.values(LabelType);
const AUDIO_LABEL_TYPES = [LabelType.SPEECH, LabelType.SPEAKER];

describe('mediaTypeSupportsLabelType', () => {
  it('video supports every label type', () => {
    for (const labelType of ALL_LABEL_TYPES) {
      expect(mediaTypeSupportsLabelType(MediaType.VIDEO, labelType)).toBe(true);
    }
  });

  it('audio supports only speech and speaker', () => {
    for (const labelType of ALL_LABEL_TYPES) {
      const expected = AUDIO_LABEL_TYPES.includes(labelType);
      expect(mediaTypeSupportsLabelType(MediaType.AUDIO, labelType)).toBe(
        expected
      );
    }
  });

  it('images support no label types', () => {
    for (const labelType of ALL_LABEL_TYPES) {
      expect(mediaTypeSupportsLabelType(MediaType.IMAGE, labelType)).toBe(
        false
      );
    }
  });
});

describe('mediaTypeSupportsLabelJobType', () => {
  it('audio allows only the speech/speaker jobs', () => {
    for (const jobType of LABEL_JOB_TYPES) {
      const expected = jobType === 'speech' || jobType === 'speaker';
      expect(mediaTypeSupportsLabelJobType(MediaType.AUDIO, jobType)).toBe(
        expected
      );
    }
  });

  it('images allow no jobs; video allows all', () => {
    for (const jobType of LABEL_JOB_TYPES) {
      expect(mediaTypeSupportsLabelJobType(MediaType.IMAGE, jobType)).toBe(
        false
      );
      expect(mediaTypeSupportsLabelJobType(MediaType.VIDEO, jobType)).toBe(
        true
      );
    }
  });
});

describe('mediaTypeSupportsLabels', () => {
  it('is true for video and audio, false for images', () => {
    expect(mediaTypeSupportsLabels(MediaType.VIDEO)).toBe(true);
    expect(mediaTypeSupportsLabels(MediaType.AUDIO)).toBe(true);
    expect(mediaTypeSupportsLabels(MediaType.IMAGE)).toBe(false);
  });
});
