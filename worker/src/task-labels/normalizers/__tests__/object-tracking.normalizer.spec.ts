import { describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ObjectTrackingNormalizer } from '../object-tracking.normalizer';
import { LabelType } from '@project/shared';
import {
  loadFixture,
  mapObjectTrackingFixture,
  createMockInput,
} from '../../__tests__/utils/test-utils';
import type { ObjectTrackingResponse } from '../../types';

/** One tracked object, with GCVI's habit of reusing "0" as the track id. */
function object(
  entity: string,
  start: number,
  end: number,
  left = 0.1
): ObjectTrackingResponse['objects'][number] {
  const box = { left, top: 0.2, right: left + 0.3, bottom: 0.6 };
  return {
    entity,
    trackId: '0',
    confidence: 0.9,
    frames: [
      { timeOffset: start, boundingBox: box, confidence: 0.9 },
      { timeOffset: end, boundingBox: box, confidence: 0.9 },
    ],
  };
}

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
    const first = output.labelObjects?.[0];
    expect(first?.objectHash).toBeDefined();
    expect(first?.duration).toBeGreaterThanOrEqual(0.5); // MIN_CLIP_DURATION
  });

  // The union box is what makes a spatial query an indexed row read instead of
  // a parse of the (up to 10MB) keyframes array.
  it('stamps each track with the union of its keyframe boxes', async () => {
    const drifting: ObjectTrackingResponse = {
      objects: [
        {
          entity: 'dog',
          trackId: '0',
          confidence: 0.9,
          frames: [
            {
              timeOffset: 0,
              boundingBox: { left: 0.4, top: 0.5, right: 0.6, bottom: 0.7 },
              confidence: 0.9,
            },
            {
              timeOffset: 1,
              boundingBox: { left: 0.1, top: 0.6, right: 0.5, bottom: 0.9 },
              confidence: 0.9,
            },
          ],
        },
      ],
    };

    const output = await normalizer.normalize(
      createMockInput(drifting, 'object-tracking')
    );

    expect(output.labelTracks[0].boundingBox).toEqual({
      left: 0.1,
      top: 0.5,
      right: 0.6,
      bottom: 0.9,
    });
  });

  it('gives every object in a response its own instance key', async () => {
    const response: ObjectTrackingResponse = {
      // Same name, same provider trackId — three different things.
      objects: [
        object('food', 0, 3),
        object('food', 10, 14),
        object('dog', 0, 3),
      ],
    };

    const output = await normalizer.normalize(
      createMockInput(response, 'object-tracking')
    );

    expect(new Set(output.labelEntities.map((e) => e.entityHash)).size).toBe(3);
    expect(new Set(output.labelTracks.map((t) => t.trackHash)).size).toBe(3);
  });

  // The regression: the instance key used to be `${trackId}_${arrayIndex}`, so
  // a re-detect that returned the same objects in another order — or dropped
  // one, which nudging the executor's confidence threshold alone can do —
  // re-keyed every entity and stranded the manual tags hanging off them.
  it('keeps instance keys stable across response order and count', async () => {
    const a = object('food', 0, 3);
    const b = object('food', 10, 14, 0.5);
    const c = object('dog', 5, 9);

    const first = await normalizer.normalize(
      createMockInput({ objects: [a, b, c] }, 'object-tracking')
    );
    // Re-detect: reordered, and one object gone.
    const second = await normalizer.normalize(
      createMockInput({ objects: [c, a] }, 'object-tracking')
    );

    const keys = (out: Awaited<ReturnType<typeof normalizer.normalize>>) =>
      new Set(out.labelEntities.map((e) => e.entityHash));
    const firstKeys = keys(first);
    const secondKeys = keys(second);

    expect(secondKeys.size).toBe(2);
    for (const key of secondKeys) expect(firstKeys.has(key)).toBe(true);
    // Track and object hashes ride the same id, so they upsert too.
    expect(second.labelTracks.map((t) => t.trackHash).sort()).toEqual(
      first.labelTracks
        .filter((t) => t.start !== 10)
        .map((t) => t.trackHash)
        .sort()
    );
  });

  it('separates duplicate detections instead of colliding them', async () => {
    // Identical name, span and opening box: the provider listed one detection
    // twice. Both still need their own row, so the later one is suffixed.
    const duplicate = object('food', 0, 3);
    const output = await normalizer.normalize(
      createMockInput(
        { objects: [duplicate, { ...duplicate }] },
        'object-tracking'
      )
    );

    expect(output.labelEntities).toHaveLength(2);
    expect(new Set(output.labelEntities.map((e) => e.entityHash)).size).toBe(2);
    expect(new Set(output.labelTracks.map((t) => t.trackHash)).size).toBe(2);
    // The first occurrence keeps the bare id; only the duplicate is suffixed.
    const [head, tail] = output.labelTracks.map((t) => t.trackId);
    expect(tail).toBe(`${head}_1`);
  });
});
