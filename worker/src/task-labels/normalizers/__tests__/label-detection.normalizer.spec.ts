import { describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { LabelDetectionNormalizer } from '../label-detection.normalizer';
import { LabelType } from '@project/shared';
import {
  loadFixture,
  mapLabelDetectionFixture,
  createMockInput,
} from '../../__tests__/utils/test-utils';

describe('LabelDetectionNormalizer', () => {
  let normalizer: LabelDetectionNormalizer;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LabelDetectionNormalizer],
    }).compile();

    normalizer = module.get<LabelDetectionNormalizer>(LabelDetectionNormalizer);
  });

  it('should be defined', () => {
    expect(normalizer).toBeDefined();
  });

  it('should normalize data from label-detection.json fixture', async () => {
    const fixture = loadFixture('label-detection.json');
    const mappedResponse = mapLabelDetectionFixture(fixture);
    const input = createMockInput(mappedResponse, 'label-detection');

    const output = await normalizer.normalize(input);

    // Verify entities (deduplicated)
    expect(output.labelEntities.length).toBeGreaterThan(0);

    // Check for some expected labels from the fixture
    const mountainEntity = output.labelEntities.find(
      (e) => e.canonicalName === 'mountain'
    );
    expect(mountainEntity).toBeDefined();
    expect(mountainEntity?.labelType).toBe(LabelType.SEGMENT);

    // Verify segments
    expect(output.labelSegments?.length).toBeGreaterThan(0);
    const mountainSegment = output.labelSegments?.find(
      (s) => s.entity === 'mountain'
    );
    expect(mountainSegment).toBeDefined();
    expect(typeof mountainSegment?.start).toBe('number');
    expect(typeof mountainSegment?.end).toBe('number');

    // Verify shots
    expect(output.labelShots?.length).toBeGreaterThan(0);

    // Verify clips (backward compatibility)
    expect(output.labelClips?.length).toBeGreaterThan(0);
    const mountainClip = output.labelClips?.find((c) => c.type === 'mountain');
    expect(mountainClip).toBeDefined();

    // Verify media update
    expect(output.labelMediaUpdate).toBeDefined();
    expect(output.labelMediaUpdate.segmentLabelCount).toBeGreaterThan(0);
    expect(output.labelMediaUpdate.shotLabelCount).toBeGreaterThan(0);
  });

  it('emits one entity per label class per media, not per interval', async () => {
    // Shots and segments have no track, so their instance is the label class
    // within the media: every "mountain" interval shares one LabelEntity, so
    // tagging it is one action and a dense video does not mint hundreds of
    // rows. Case and surrounding whitespace are the provider being
    // inconsistent, not a second class.
    const response = {
      segmentLabels: [
        {
          entity: 'mountain',
          confidence: 0.9,
          segments: [
            { startTime: 0, endTime: 2, confidence: 0.9 },
            { startTime: 8, endTime: 9, confidence: 0.8 },
          ],
        },
        {
          entity: ' Mountain ',
          confidence: 0.7,
          segments: [{ startTime: 20, endTime: 21, confidence: 0.7 }],
        },
      ],
      shotLabels: [
        {
          entity: 'mountain',
          confidence: 0.6,
          segments: [
            { startTime: 0, endTime: 1, confidence: 0.6 },
            { startTime: 4, endTime: 5, confidence: 0.5 },
          ],
        },
      ],
      shots: [],
    };

    const output = await normalizer.normalize(
      createMockInput(response, 'label-detection')
    );

    // Three segment intervals + two shot intervals, but one entity per type.
    expect(output.labelSegments).toHaveLength(3);
    expect(output.labelShots).toHaveLength(2);
    expect(output.labelEntities).toHaveLength(2);

    const byType = new Map(
      output.labelEntities.map((e) => [e.labelType, e] as const)
    );
    expect(byType.get(LabelType.SEGMENT)?.instanceId).toBe('mountain');
    expect(byType.get(LabelType.SHOT)?.instanceId).toBe('mountain');
    // The key carries the media, which is what stops one video's "mountain"
    // from claiming another's.
    expect(byType.get(LabelType.SEGMENT)?.entityHash).toContain(':mountain:');
    expect(new Set(output.labelEntities.map((e) => e.entityHash)).size).toBe(2);
  });

  it('clamps out-of-range confidence into [0, 1] for segments, shots, and clips', async () => {
    // GCVI occasionally returns confidence marginally above 1.0; every
    // confidence written to the DB must land in [0, 1] or Zod rejects the insert.
    const response = {
      segmentLabels: [
        {
          entity: 'overconfident',
          confidence: 1.0000001,
          segments: [{ startTime: 0, endTime: 1, confidence: 1.0000001 }],
        },
      ],
      shotLabels: [
        {
          entity: 'overconfident-shot',
          confidence: 1.5,
          segments: [{ startTime: 0, endTime: 1, confidence: 1.5 }],
        },
      ],
      shots: [{ startTime: 0, endTime: 1 }],
    };
    const input = createMockInput(response, 'label-detection');

    const output = await normalizer.normalize(input);

    const allConfidences = [
      ...(output.labelSegments ?? []).map((s) => s.confidence),
      ...(output.labelShots ?? []).map((s) => s.confidence),
      ...(output.labelClips ?? []).map((c) => c.confidence),
      ...output.labelEntities.map(
        (e) => e.metadata?.confidence as number | undefined
      ),
    ].filter((c): c is number => typeof c === 'number');

    expect(allConfidences.length).toBeGreaterThan(0);
    for (const c of allConfidences) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});
