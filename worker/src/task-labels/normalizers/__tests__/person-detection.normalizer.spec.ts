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

    // One entity per person track, not one shared "Person" entity — the
    // provider gives no identity, so keying by name would make everyone in
    // the media a single link point and impossible to name individually.
    expect(output.labelEntities.length).toBe(output.labelTracks.length);
    expect(
      output.labelEntities.every((e) => e.canonicalName === 'Person')
    ).toBe(true);
    expect(
      output.labelEntities.every((e) => e.labelType === LabelType.PERSON)
    ).toBe(true);

    // Distinct instance keys, all scoped to this media
    expect(new Set(output.labelEntities.map((e) => e.entityHash)).size).toBe(
      output.labelEntities.length
    );
    expect(
      output.labelEntities.every((e) => e.MediaRef === 'test-media-id')
    ).toBe(true);

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

  // Same rule as faces and objects: when the provider gives no track id, the
  // instance key comes from the detection, never from its slot in the array,
  // so a re-detect keeps the entities its manual tags hang off.
  it('derives trackless person ids from content, stable across ordering', async () => {
    const person = (start: number, left: number) => ({
      trackId: '',
      frames: [
        {
          timeOffset: start,
          boundingBox: { left, top: 0.1, right: left + 0.2, bottom: 0.9 },
          confidence: 0.8,
        },
        {
          timeOffset: start + 3,
          boundingBox: { left, top: 0.1, right: left + 0.2, bottom: 0.9 },
          confidence: 0.8,
        },
      ],
    });
    const a = person(0, 0.1);
    const b = person(6, 0.5);
    const run = (persons: unknown[]) =>
      normalizer.normalize(
        createMockInput({ persons } as never, 'person-detection')
      );

    const first = await run([a, b]);
    const reordered = await run([b, a]);

    expect(new Set(first.labelEntities.map((e) => e.entityHash)).size).toBe(2);
    expect(new Set(reordered.labelEntities.map((e) => e.entityHash))).toEqual(
      new Set(first.labelEntities.map((e) => e.entityHash))
    );
  });
});
