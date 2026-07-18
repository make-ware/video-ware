import { describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { TextDetectionNormalizer } from '../text-detection.normalizer';
import { LabelType } from '@project/shared';
import { createMockInput } from '../../__tests__/utils/test-utils';
import type { TextDetectionResponse } from '../../types';

const RESPONSE: TextDetectionResponse = {
  texts: [
    {
      text: 'BREAKING NEWS',
      confidence: 0.97,
      startTime: 1.2,
      endTime: 4.8,
      frames: [
        {
          timeOffset: 1.2,
          boundingBox: { left: 0.1, top: 0.8, right: 0.5, bottom: 0.9 },
        },
        {
          timeOffset: 4.8,
          boundingBox: { left: 0.1, top: 0.8, right: 0.5, bottom: 0.9 },
        },
      ],
    },
    // Second appearance of the SAME string: distinct track/row, one entity
    {
      text: 'BREAKING NEWS',
      confidence: 0.93,
      startTime: 30.0,
      endTime: 33.5,
      frames: [
        {
          timeOffset: 30.0,
          boundingBox: { left: 0.1, top: 0.8, right: 0.5, bottom: 0.9 },
        },
      ],
    },
    {
      text: 'channel 7',
      confidence: 0.88,
      startTime: 0,
      endTime: 60,
      frames: [
        {
          timeOffset: 0,
          boundingBox: { left: 0.85, top: 0.05, right: 0.98, bottom: 0.12 },
        },
      ],
    },
  ],
};

describe('TextDetectionNormalizer', () => {
  let normalizer: TextDetectionNormalizer;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TextDetectionNormalizer],
    }).compile();

    normalizer = module.get<TextDetectionNormalizer>(TextDetectionNormalizer);
  });

  it('should be defined', () => {
    expect(normalizer).toBeDefined();
  });

  it('creates one entity per unique string, one track and row per appearance', async () => {
    const input = createMockInput(RESPONSE, 'text-detection');

    const output = await normalizer.normalize(input);

    // Two unique strings → two entities, deduped across appearances
    expect(output.labelEntities).toHaveLength(2);
    const breaking = output.labelEntities.find(
      (e) => e.canonicalName === 'BREAKING NEWS'
    );
    expect(breaking).toBeDefined();
    expect(breaking?.labelType).toBe(LabelType.TEXT);

    // Three appearances → three tracks and three LabelText rows
    expect(output.labelTracks).toHaveLength(3);
    expect(output.labelTexts).toHaveLength(3);

    // Track hashes and ids must be distinct per appearance
    const trackHashes = new Set(output.labelTracks.map((t) => t.trackHash));
    expect(trackHashes.size).toBe(3);

    // Rows carry timing from the segment and link back to their track
    const first = output.labelTexts![0];
    expect(first.text).toBe('BREAKING NEWS');
    expect(first.start).toBe(1.2);
    expect(first.end).toBe(4.8);
    expect(first.duration).toBeCloseTo(3.6);
    expect(first.textHash).toBeTruthy();
    expect(first.originalTrackId).toBe(output.labelTracks[0].trackId);

    // Keyframes preserved on the track
    expect(output.labelTracks[0].keyframes).toHaveLength(2);
    expect(output.labelTracks[0].keyframes[0].bbox.left).toBe(0.1);

    // Aggregates
    expect(output.labelMediaUpdate.textCount).toBe(3);
    expect(output.labelMediaUpdate.textTrackCount).toBe(3);
    expect(output.labelMediaUpdate.textDetectionProcessor).toBe(
      'text-detection:1.0.0'
    );
  });

  it('handles an empty response', async () => {
    const input = createMockInput(
      { texts: [] } as TextDetectionResponse,
      'text-detection'
    );

    const output = await normalizer.normalize(input);

    expect(output.labelEntities).toHaveLength(0);
    expect(output.labelTracks).toHaveLength(0);
    expect(output.labelTexts).toHaveLength(0);
    expect(output.labelMediaUpdate.textCount).toBe(0);
  });
});
