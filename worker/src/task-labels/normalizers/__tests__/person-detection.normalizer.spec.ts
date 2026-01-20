import { describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { PersonDetectionNormalizer } from '../person-detection.normalizer';
import { LabelType } from '@project/shared';
import {
  loadFixture,
  mapPersonDetectionFixture,
  createMockInput,
} from '../../__tests__/utils/test-utils';

describe('PersonDetectionNormalizer', () => {
  let normalizer: PersonDetectionNormalizer;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PersonDetectionNormalizer],
    }).compile();

    normalizer = module.get<PersonDetectionNormalizer>(
      PersonDetectionNormalizer
    );
  });

  it('should be defined', () => {
    expect(normalizer).toBeDefined();
  });

  it('should normalize data from person-detection.json fixture', async () => {
    const fixture = loadFixture('person-detection.json');
    const mappedResponse = mapPersonDetectionFixture(fixture);
    const input = createMockInput(mappedResponse, 'person-detection');

    const output = await normalizer.normalize(input);

    // Verify entity creation
    expect(output.labelEntities.length).toBe(1);
    expect(output.labelEntities[0].canonicalName).toBe('Person');
    expect(output.labelEntities[0].labelType).toBe(LabelType.PERSON);

    // Verify tracks
    expect(output.labelTracks.length).toBeGreaterThan(0);
    const track = output.labelTracks[0];
    expect(track.trackHash).toBeDefined();
    expect(track.trackId).toBeDefined();
    expect(track.keyframes.length).toBeGreaterThan(0);

    // Check aggregated attributes and landmarks in trackData
    const trackData = track.trackData as any;
    expect(trackData.attributes).toBeDefined();
    expect(trackData.landmarks).toBeDefined();
    expect(trackData.attributes.upperClothingColor).toBeDefined();

    // Verify people (filtered tracks)
    expect(output.labelPeople?.length).toBeGreaterThan(0);
    const person = output.labelPeople?.[0];
    expect(person?.personHash).toBeDefined();
    expect(person?.duration).toBeGreaterThanOrEqual(0.5); // MIN_CLIP_DURATION
    expect(person?.upperBodyColor).toBeDefined();
    expect(person?.hasLandmarks).toBe(true);

    // Verify media update
    expect(output.labelMediaUpdate.personCount).toBeGreaterThan(0);
    expect(output.labelMediaUpdate.personTrackCount).toBeGreaterThan(0);
  });
});
