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
    // Second appearance of the SAME string, far from the first: distinct
    // track/row, one entity
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

/**
 * Raw OCR noise around one real string: sub-second fragments and misread
 * variants that the cleaning pass must fold away.
 */
const NOISY_RESPONSE: TextDetectionResponse = {
  texts: [
    {
      text: 'Statf only',
      confidence: 0.81,
      startTime: 168.66,
      endTime: 168.66,
      frames: [],
    },
    {
      text: 'Staff anly',
      confidence: 0.91,
      startTime: 168.79,
      endTime: 168.79,
      frames: [],
    },
    {
      text: 'Staff only',
      confidence: 0.87,
      startTime: 169.54,
      endTime: 170.54,
      frames: [],
    },
    // Same string again after a small OCR dropout: merges into one run
    {
      text: 'Staff only',
      confidence: 0.9,
      startTime: 170.8,
      endTime: 171.8,
      frames: [],
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

    // Rows sorted by start time, carry timing, and link back to their track
    expect(output.labelTexts!.map((t) => t.text)).toEqual([
      'channel 7',
      'BREAKING NEWS',
      'BREAKING NEWS',
    ]);
    const first = output.labelTexts![1];
    expect(first.text).toBe('BREAKING NEWS');
    expect(first.start).toBe(1.2);
    expect(first.end).toBe(4.8);
    expect(first.duration).toBeCloseTo(3.6);
    expect(first.textHash).toBeTruthy();
    expect(first.originalTrackId).toBe(output.labelTracks[1].trackId);

    // Keyframes preserved on the track
    expect(output.labelTracks[1].keyframes).toHaveLength(2);
    expect(output.labelTracks[1].keyframes[0].bbox.left).toBe(0.1);

    // Aggregates
    expect(output.labelMediaUpdate.textCount).toBe(3);
    expect(output.labelMediaUpdate.textTrackCount).toBe(3);
    expect(output.labelMediaUpdate.textDetectionProcessor).toBe(
      'text-detection:1.0.0'
    );
  });

  it('cleans OCR noise: merges fragments, drops flickers and misreads', async () => {
    const input = createMockInput(NOISY_RESPONSE, 'text-detection');

    const output = await normalizer.normalize(input);

    // Only the real string survives; its two nearby appearances merge
    expect(output.labelTexts).toHaveLength(1);
    const row = output.labelTexts![0];
    expect(row.text).toBe('Staff only');
    expect(row.start).toBeCloseTo(169.54);
    expect(row.end).toBeCloseTo(171.8);
    expect(row.confidence).toBe(0.9);
    expect(row.metadata?.segmentCount).toBe(2);

    expect(output.labelEntities).toHaveLength(1);
    expect(output.labelTracks).toHaveLength(1);
    expect(output.labelMediaUpdate.textCount).toBe(1);
  });

  it('honors cleaning option overrides', async () => {
    const input = createMockInput(NOISY_RESPONSE, 'text-detection');

    const output = await normalizer.normalize(input, {
      minDurationSec: 0,
      minConfidence: 0,
      mergeGapSec: 0,
    });

    // Nothing filtered, nothing merged: every raw segment becomes a row
    expect(output.labelTexts).toHaveLength(4);
  });

  it('produces content-based hashes that are stable across re-runs and input order', async () => {
    const input = createMockInput(RESPONSE, 'text-detection');
    const reordered = createMockInput(
      { texts: [...RESPONSE.texts].reverse() },
      'text-detection'
    );

    const a = await normalizer.normalize(input);
    const b = await normalizer.normalize(reordered);

    expect(new Set(a.labelTracks.map((t) => t.trackHash))).toEqual(
      new Set(b.labelTracks.map((t) => t.trackHash))
    );
    expect(new Set(a.labelTexts!.map((t) => t.textHash))).toEqual(
      new Set(b.labelTexts!.map((t) => t.textHash))
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
