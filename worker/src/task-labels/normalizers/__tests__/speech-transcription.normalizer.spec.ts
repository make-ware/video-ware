import { describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { SpeechTranscriptionNormalizer } from '../speech-transcription.normalizer';
import { NormalizerInput } from '../../types';
import {
  loadFixture,
  mapSpeechTranscriptionFixture,
  createMockInput,
} from '../../__tests__/utils/test-utils';

describe('SpeechTranscriptionNormalizer', () => {
  let normalizer: SpeechTranscriptionNormalizer;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SpeechTranscriptionNormalizer],
    }).compile();

    normalizer = module.get<SpeechTranscriptionNormalizer>(
      SpeechTranscriptionNormalizer
    );
  });

  it('should be defined', () => {
    expect(normalizer).toBeDefined();
  });

  it('should normalize data from speech-transcription.json fixture', async () => {
    const fixture = loadFixture('speech-transcription.json');
    const mappedResponse = mapSpeechTranscriptionFixture(fixture);
    const input = createMockInput(mappedResponse, 'speech-transcription');

    const output = await normalizer.normalize(input);

    // Verify entity creation
    expect(output.labelEntities.length).toBeGreaterThan(0);

    // Check for "Clip Speaker" or "Track" entity
    const speakerEntity = output.labelEntities.find(
      (e) =>
        e.canonicalName.startsWith('Clip Speaker') ||
        e.canonicalName.startsWith('Track')
    );
    expect(speakerEntity).toBeDefined();

    // Verify speech segments
    expect(output.labelSpeech?.length).toBeGreaterThan(0);
    const segment = output.labelSpeech![0];
    expect(segment.transcript).toBeDefined();
    expect(typeof segment.start).toBe('number');
    expect(typeof segment.end).toBe('number');

    // Verify tracks (grouped by speaker)
    expect(output.labelTracks.length).toBeGreaterThan(0);

    // Verify media update
    expect(output.labelMediaUpdate).toBeDefined();
    expect(
      output.labelMediaUpdate.speechTranscriptionProcessedAt
    ).toBeDefined();
  });

  it('should normalize speech transcription response into segments', async () => {
    const input: NormalizerInput<any> = {
      response: {
        transcript: 'Hello world. This is a test.',
        words: [
          { word: 'Hello', startTime: 0, endTime: 0.5, confidence: 0.9 },
          { word: 'world', startTime: 0.6, endTime: 1.0, confidence: 0.9 },
          { word: 'This', startTime: 2.0, endTime: 2.5, confidence: 0.8 },
          { word: 'is', startTime: 2.6, endTime: 2.8, confidence: 0.8 },
          { word: 'a', startTime: 2.9, endTime: 3.0, confidence: 0.8 },
          { word: 'test', startTime: 3.1, endTime: 3.5, confidence: 0.9 },
        ],
        languageCode: 'en-US',
      },
      mediaId: 'media-1',
      workspaceRef: 'workspace-1',
      taskRef: 'task-1',
      version: 1,
      processor: 'speech-transcription',
      processorVersion: '1.0.0',
    };

    const output = await normalizer.normalize(input);

    expect(output.labelEntities.length).toBeGreaterThan(0); // Significant words/Speaker
    expect(output.labelSpeech?.length).toBeGreaterThan(0); // Segments

    const segments = output.labelSpeech || [];
    expect(segments.length).toBe(1); // 3.5 seconds total < 30s
    expect(segments[0].transcript).toBe('Hello world This is a test');
    expect(segments[0].start).toBe(0);
    expect(segments[0].end).toBe(3.5);
  });

  it('should segment speech by speaker', async () => {
    const input: NormalizerInput<any> = {
      response: {
        transcript: 'Hello from speaker 1. Hello from speaker 2.',
        words: [
          {
            word: 'Hello',
            startTime: 0,
            endTime: 0.5,
            confidence: 0.9,
            speakerTag: 1,
          },
          {
            word: 'from',
            startTime: 0.6,
            endTime: 1.0,
            confidence: 0.9,
            speakerTag: 1,
          },
          {
            word: 'speaker',
            startTime: 1.1,
            endTime: 1.5,
            confidence: 0.9,
            speakerTag: 1,
          },
          {
            word: '1',
            startTime: 1.6,
            endTime: 2.0,
            confidence: 0.9,
            speakerTag: 1,
          },
          {
            word: 'Hello',
            startTime: 2.1,
            endTime: 2.5,
            confidence: 0.9,
            speakerTag: 2,
          },
          {
            word: 'from',
            startTime: 2.6,
            endTime: 3.0,
            confidence: 0.9,
            speakerTag: 2,
          },
          {
            word: 'speaker',
            startTime: 3.1,
            endTime: 3.5,
            confidence: 0.9,
            speakerTag: 2,
          },
          {
            word: '2',
            startTime: 3.6,
            endTime: 4.0,
            confidence: 0.9,
            speakerTag: 2,
          },
        ],
        languageCode: 'en-US',
      },
      mediaId: 'media-1',
      workspaceRef: 'workspace-1',
      taskRef: 'task-1',
      version: 1,
      processor: 'speech-transcription',
      processorVersion: '1.0.0',
    };

    const output = await normalizer.normalize(input);
    const segments = output.labelSpeech || [];

    expect(segments.length).toBe(2);

    expect(segments[0].speakerTag).toBe(1);
    expect(segments[0].transcript).toBe('Hello from speaker 1');

    expect(segments[1].speakerTag).toBe(2);
    expect(segments[1].transcript).toBe('Hello from speaker 2');
  });
});
