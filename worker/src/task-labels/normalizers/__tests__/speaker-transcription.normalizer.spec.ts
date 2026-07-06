import { describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { LabelType, ProcessingProvider } from '@project/shared';
import { SpeakerTranscriptionNormalizer } from '../speaker-transcription.normalizer';
import type {
  NormalizerInput,
  SpeakerTranscriptionResponse,
} from '../../types';
import { createMockInput } from '../../__tests__/utils/test-utils';

function makeResponse(
  overrides: Partial<SpeakerTranscriptionResponse> = {}
): SpeakerTranscriptionResponse {
  return {
    transcript: 'Hello there. Hi, thanks for having me.',
    languageCode: 'en',
    languageProbability: 0.98,
    words: [
      {
        text: 'Hello',
        type: 'word',
        start: 0.0,
        end: 0.4,
        speakerId: 'speaker_0',
      },
      {
        text: ' ',
        type: 'spacing',
        start: 0.4,
        end: 0.45,
        speakerId: 'speaker_0',
      },
      {
        text: 'there.',
        type: 'word',
        start: 0.45,
        end: 0.9,
        speakerId: 'speaker_0',
      },
      {
        text: 'Hi,',
        type: 'word',
        start: 1.5,
        end: 1.8,
        speakerId: 'speaker_1',
      },
      {
        text: 'thanks',
        type: 'word',
        start: 1.9,
        end: 2.2,
        speakerId: 'speaker_1',
      },
      {
        text: 'for',
        type: 'word',
        start: 2.3,
        end: 2.4,
        speakerId: 'speaker_1',
      },
      {
        text: 'having',
        type: 'word',
        start: 2.5,
        end: 2.8,
        speakerId: 'speaker_1',
      },
      {
        text: 'me.',
        type: 'word',
        start: 2.9,
        end: 3.1,
        speakerId: 'speaker_1',
      },
    ],
    ...overrides,
  };
}

describe('SpeakerTranscriptionNormalizer', () => {
  let normalizer: SpeakerTranscriptionNormalizer;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SpeakerTranscriptionNormalizer],
    }).compile();

    normalizer = module.get<SpeakerTranscriptionNormalizer>(
      SpeakerTranscriptionNormalizer
    );
  });

  it('should be defined', () => {
    expect(normalizer).toBeDefined();
  });

  it('should create one entity and one track per speaker', async () => {
    const input = createMockInput(makeResponse(), 'speaker-transcription');

    const output = await normalizer.normalize(input);

    expect(output.labelEntities).toHaveLength(2);
    const names = output.labelEntities.map((e) => e.canonicalName).sort();
    expect(names).toEqual(['Speaker 1', 'Speaker 2']);
    for (const entity of output.labelEntities) {
      expect(entity.labelType).toBe(LabelType.SPEAKER);
      expect(entity.provider).toBe(ProcessingProvider.ELEVENLABS);
      expect((entity.metadata as { speakerId?: string }).speakerId).toMatch(
        /^speaker_\d$/
      );
    }

    expect(output.labelTracks).toHaveLength(2);
    const track0 = output.labelTracks.find((t) => t.trackId === 'speaker_0');
    expect(track0).toBeDefined();
    expect(track0!.start).toBe(0.0);
    expect(track0!.end).toBe(0.9);
    expect(track0!.provider).toBe(ProcessingProvider.ELEVENLABS);
    expect(track0!.keyframes).toEqual([]);
  });

  it('should split utterances on speaker change and drop spacing tokens', async () => {
    const input = createMockInput(makeResponse(), 'speaker-transcription');

    const output = await normalizer.normalize(input);

    expect(output.labelSpeakers).toHaveLength(2);

    const [first, second] = output.labelSpeakers!;
    expect(first.transcript).toBe('Hello there.');
    expect(first.speakerId).toBe('speaker_0');
    expect(first.start).toBe(0.0);
    expect(first.end).toBe(0.9);
    expect(first.duration).toBeCloseTo(0.9);
    // spacing token excluded from words
    expect(first.words).toHaveLength(2);
    expect(first.words.map((w) => w.text)).toEqual(['Hello', 'there.']);

    expect(second.transcript).toBe('Hi, thanks for having me.');
    expect(second.speakerId).toBe('speaker_1');
    expect(second.words).toHaveLength(5);

    // Hashes are unique per utterance
    const hashes = new Set(output.labelSpeakers!.map((s) => s.speakerHash));
    expect(hashes.size).toBe(2);
  });

  it('should split long single-speaker runs at the max utterance duration', async () => {
    const words = Array.from({ length: 40 }, (_, i) => ({
      text: `word${i}`,
      type: 'word' as const,
      start: i * 1.0,
      end: i * 1.0 + 0.5,
      speakerId: 'speaker_0',
    }));
    const input = createMockInput(
      makeResponse({ words, transcript: words.map((w) => w.text).join(' ') }),
      'speaker-transcription'
    );

    const output = await normalizer.normalize(input);

    expect(output.labelEntities).toHaveLength(1);
    expect(output.labelSpeakers!.length).toBeGreaterThan(1);
    for (const utterance of output.labelSpeakers!) {
      expect(utterance.duration).toBeLessThanOrEqual(31);
    }
  });

  it('should bucket words without a speaker id under an unknown speaker', async () => {
    const input = createMockInput(
      makeResponse({
        words: [
          { text: 'Hello', type: 'word', start: 0, end: 0.5 },
          { text: 'world', type: 'word', start: 0.6, end: 1.0 },
        ],
        transcript: 'Hello world',
      }),
      'speaker-transcription'
    );

    const output = await normalizer.normalize(input);

    expect(output.labelSpeakers).toHaveLength(1);
    expect(output.labelSpeakers![0].speakerId).toBe('speaker_unknown');
    expect(output.labelEntities[0].canonicalName).toBe('speaker_unknown');
  });

  it('should produce empty outputs for a response with no spoken words', async () => {
    const input: NormalizerInput<SpeakerTranscriptionResponse> =
      createMockInput(
        makeResponse({ words: [], transcript: '' }),
        'speaker-transcription'
      );

    const output = await normalizer.normalize(input);

    expect(output.labelEntities).toHaveLength(0);
    expect(output.labelTracks).toHaveLength(0);
    expect(output.labelSpeakers).toHaveLength(0);
    expect(output.labelMediaUpdate.wordCount).toBe(0);
    expect(output.labelMediaUpdate.speakerCount).toBe(0);
  });

  it('should populate the media update with counts and processor info', async () => {
    const input = createMockInput(makeResponse(), 'speaker-transcription');

    const output = await normalizer.normalize(input);

    expect(
      output.labelMediaUpdate.speakerTranscriptionProcessedAt
    ).toBeDefined();
    expect(output.labelMediaUpdate.speakerTranscriptionProcessor).toBe(
      'speaker-transcription:1.0.0'
    );
    expect(output.labelMediaUpdate.wordCount).toBe(7); // spacing excluded
    expect(output.labelMediaUpdate.speakerCount).toBe(2);
    expect(output.labelMediaUpdate.processors).toEqual([
      'speaker_transcription',
    ]);
  });

  it('should clamp confidence to [0, 1]', async () => {
    const input = createMockInput(
      makeResponse({ languageProbability: 1.2 }),
      'speaker-transcription'
    );

    const output = await normalizer.normalize(input);

    for (const utterance of output.labelSpeakers!) {
      expect(utterance.confidence).toBe(1);
    }
  });
});
