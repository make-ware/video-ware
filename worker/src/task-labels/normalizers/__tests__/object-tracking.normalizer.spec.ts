import { describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ObjectTrackingNormalizer } from '../object-tracking.normalizer';
import { LabelType } from '@project/shared';
import {
  loadFixture,
  mapObjectTrackingFixture,
  createMockInput,
} from '../../__tests__/utils/test-utils';

describe('ObjectTrackingNormalizer', () => {
  let normalizer: ObjectTrackingNormalizer;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ObjectTrackingNormalizer],
    }).compile();

    normalizer = module.get<ObjectTrackingNormalizer>(ObjectTrackingNormalizer);
  });

  it('should be defined', () => {
    expect(normalizer).toBeDefined();
  });

  it('should normalize data from object-tracking.json fixture', async () => {
    const fixture = loadFixture('object-tracking.json');
    const mappedResponse = mapObjectTrackingFixture(fixture);
    const input = createMockInput(mappedResponse, 'object-tracking');

    const output = await normalizer.normalize(input);

    // Verify entities
    expect(output.labelEntities.length).toBeGreaterThan(0);
    const personEntity = output.labelEntities.find(
      (e) => e.canonicalName === 'person'
    );
    expect(personEntity).toBeDefined();
    expect(personEntity?.labelType).toBe(LabelType.OBJECT);

    // Verify tracks
    expect(output.labelTracks.length).toBeGreaterThan(0);
    const track = output.labelTracks[0];
    expect(track.trackHash).toBeDefined();
    expect(track.trackId).toBeDefined();
    expect(track.keyframes.length).toBeGreaterThan(0);
    expect(track.trackData.entity).toBeDefined();

    // Verify objects (filtered tracks)
    expect(output.labelObjects?.length).toBeGreaterThan(0);
    const object = output.labelObjects?.[0];
    expect(object?.objectHash).toBeDefined();
    expect(object?.duration).toBeGreaterThanOrEqual(0.5); // MIN_CLIP_DURATION
  });
});
