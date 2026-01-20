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
});
