import { describe, it, expect, vi } from 'vitest';
import {
  PersonDetectionExecutor,
  mapPersonDetectionResponse,
  resolvePersonDetectionConfig,
} from '../person-detection.executor';
import { loadFixture } from '../../__tests__/utils/test-utils';
import type { GoogleCloudService } from '../../../shared/services/google-cloud.service';

/**
 * These run the REAL captured GCVI response (fixtures/person-detection.json:
 * four tracked people, track confidences 0.77 / 0.67 / 0.55 / 0.52) through
 * the production mapping. Every assertion here failed before the fix: the
 * executor filtered at a hardcoded 0.7, matched clothing attribute names that
 * GCVI never sends, and gated landmark/attribute extraction on config flags
 * the flow builder didn't set — so a real response mapped to `{persons: []}`.
 */
describe('mapPersonDetectionResponse', () => {
  const fixture = loadFixture('person-detection.json');

  it('keeps every person track GCVI reported at the default threshold', () => {
    const { persons } = mapPersonDetectionResponse(fixture);

    expect(persons).toHaveLength(4);
    expect(persons.every((p) => p.frames.length > 0)).toBe(true);
  });

  it('carries pose landmarks through with their GCVI names', () => {
    const { persons } = mapPersonDetectionResponse(fixture);
    const landmarks = persons[0].frames[0].landmarks;

    expect(landmarks?.length).toBeGreaterThan(0);
    expect(landmarks?.map((l) => l.type)).toContain('nose');
    expect(landmarks?.every((l) => l.type !== '')).toBe(true);
    // 2D model: x/y populated, z defaulted rather than dropped.
    expect(landmarks?.[0].position.x).toBeGreaterThan(0);
    expect(landmarks?.[0].position.z).toBe(0);
  });

  it('picks the highest-confidence clothing candidate, split color vs garment', () => {
    const { persons } = mapPersonDetectionResponse(fixture);
    const attributes = persons[0].frames[0].attributes;

    // The response lists 28 UpperCloth candidates; the top one is LongSleeve
    // (0.986) and the top color among them is Red (0.699). Taking the last
    // candidate in the array — what the old loop did — yields Black at 0.028.
    expect(attributes?.upperClothingType).toBe('LongSleeve');
    expect(attributes?.upperClothingColor).toBe('Red');
    // GCVI's LowerCloth vocabulary is garment-only.
    expect(attributes?.lowerClothingType).toBe('LongPants');
    expect(attributes?.lowerClothingColor).toBeUndefined();
  });

  it('honours an explicit threshold', () => {
    const strict = mapPersonDetectionResponse(fixture, {
      confidenceThreshold: 0.7,
    });
    const open = mapPersonDetectionResponse(fixture, {
      confidenceThreshold: 0,
    });

    expect(strict.persons).toHaveLength(1);
    expect(open.persons).toHaveLength(4);
  });

  it('omits landmarks and attributes only when they are not requested', () => {
    const { persons } = mapPersonDetectionResponse(fixture, {
      includePoseLandmarks: false,
      includeAttributes: false,
    });

    expect(persons[0].frames[0].landmarks).toBeUndefined();
    expect(persons[0].frames[0].attributes).toBeUndefined();
  });

  it('defaults every flag on, and the threshold to 0.5', () => {
    expect(resolvePersonDetectionConfig()).toEqual({
      includeBoundingBoxes: true,
      includePoseLandmarks: true,
      includeAttributes: true,
      confidenceThreshold: 0.5,
    });
  });

  it('tolerates an empty response', () => {
    expect(mapPersonDetectionResponse({}).persons).toEqual([]);
    expect(
      mapPersonDetectionResponse({ annotationResults: [{}] }).persons
    ).toEqual([]);
  });
});

describe('PersonDetectionExecutor', () => {
  const fixture = loadFixture('person-detection.json');

  const makeExecutor = () => {
    const annotateVideoAndWait = vi.fn().mockResolvedValue(fixture);
    const googleCloud = {
      getTempGcsUri: () => 'gs://bucket/temp/ws/media',
      annotateVideoAndWait,
    } as unknown as GoogleCloudService;

    return {
      executor: new PersonDetectionExecutor(googleCloud),
      annotateVideoAndWait,
    };
  };

  it('requests PERSON_DETECTION with the same flags it then extracts', async () => {
    const { executor, annotateVideoAndWait } = makeExecutor();

    const response = await executor.execute('ws', 'media');

    const request = annotateVideoAndWait.mock.calls[0][0];
    expect(request.inputUri).toBe('gs://bucket/temp/ws/media');
    // Feature.PERSON_DETECTION
    expect(request.features).toEqual([14]);
    expect(request.videoContext.personDetectionConfig).toEqual({
      includeBoundingBoxes: true,
      includePoseLandmarks: true,
      includeAttributes: true,
    });
    // What we asked for is what we keep.
    expect(response.persons).toHaveLength(4);
    expect(response.persons[0].frames[0].landmarks?.length).toBeGreaterThan(0);
    expect(response.persons[0].frames[0].attributes).toBeDefined();
  });

  it('returns no persons when the API reports no annotation results', async () => {
    const annotateVideoAndWait = vi.fn().mockResolvedValue({
      annotationResults: [],
    });
    const executor = new PersonDetectionExecutor({
      getTempGcsUri: () => 'gs://bucket/temp/ws/media',
      annotateVideoAndWait,
    } as unknown as GoogleCloudService);

    await expect(executor.execute('ws', 'media')).resolves.toEqual({
      persons: [],
    });
  });

  it('propagates API failures instead of caching an empty result', async () => {
    const annotateVideoAndWait = vi
      .fn()
      .mockRejectedValue(new Error('RESOURCE_EXHAUSTED'));
    const executor = new PersonDetectionExecutor({
      getTempGcsUri: () => 'gs://bucket/temp/ws/media',
      annotateVideoAndWait,
    } as unknown as GoogleCloudService);

    await expect(executor.execute('ws', 'media')).rejects.toThrow(
      /RESOURCE_EXHAUSTED/
    );
  });
});
