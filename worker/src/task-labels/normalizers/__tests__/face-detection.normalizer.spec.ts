import { describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { FaceDetectionNormalizer } from '../face-detection.normalizer';
import { NormalizerInput } from '../../types';
import {
  loadFixture,
  mapFaceDetectionFixture,
  createMockInput,
} from '../../__tests__/utils/test-utils';

describe('FaceDetectionNormalizer', () => {
  let normalizer: FaceDetectionNormalizer;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FaceDetectionNormalizer],
    }).compile();

    normalizer = module.get<FaceDetectionNormalizer>(FaceDetectionNormalizer);
  });

  it('should be defined', () => {
    expect(normalizer).toBeDefined();
  });

  it('should normalize face detection response with missing trackId', async () => {
    const input: NormalizerInput<any> = {
      response: {
        faces: [
          {
            trackId: '', // Empty trackId
            frames: [
              {
                timeOffset: 0,
                boundingBox: { left: 0, top: 0, right: 1, bottom: 1 },
                confidence: 0.9,
              },
              {
                timeOffset: 1,
                boundingBox: { left: 0, top: 0, right: 1, bottom: 1 },
                confidence: 0.9,
              },
            ],
          },
        ],
      },
      mediaId: 'media-1',
      workspaceRef: 'workspace-1',
      taskRef: 'task-1',
      version: 1,
      processor: 'face-detection',
      processorVersion: '1.0.0',
    };

    const output = await normalizer.normalize(input);

    expect(output.labelEntities.length).toBe(1);
    expect(output.labelFaces?.length).toBe(1);
    expect(output.labelTracks.length).toBe(1);

    const face = output.labelFaces?.[0];
    expect(face?.trackId).toBeDefined();
    expect(face?.trackId.length).toBeGreaterThan(0);
    expect(face?.faceHash).toBeDefined();

    const track = output.labelTracks[0];
    expect(track.trackId).toBe(face?.trackId);
  });

  it('should normalize data from face-detection.json fixture', async () => {
    const fixture = loadFixture('face-detection.json');
    const mappedResponse = mapFaceDetectionFixture(fixture);
    const input = createMockInput(mappedResponse, 'face-detection');

    const output = await normalizer.normalize(input);

    // One entity per face track, not one shared "Face" entity. The provider
    // gives no identity, so every face is named "Face" — keying entities by
    // name would make the faces in a media indistinguishable and impossible
    // to attribute to different people.
    expect(output.labelEntities.length).toBe(output.labelTracks.length);
    expect(output.labelEntities.every((e) => e.canonicalName === 'Face')).toBe(
      true
    );

    // Each is scoped to this media and keyed by its own track.
    expect(
      output.labelEntities.every((e) => e.MediaRef === 'test-media-id')
    ).toBe(true);
    expect(new Set(output.labelEntities.map((e) => e.instanceId)).size).toBe(
      output.labelEntities.length
    );
    expect(new Set(output.labelEntities.map((e) => e.entityHash)).size).toBe(
      output.labelEntities.length
    );

    // Verify faces and tracks
    expect(output.labelFaces?.length).toBeGreaterThan(0);
    expect(output.labelTracks.length).toBeGreaterThan(0);

    // Check first face mapping
    const face = output.labelFaces?.[0];
    expect(face).toBeDefined();
    expect(face?.faceHash).toBeDefined();
    expect(typeof face?.start).toBe('number');
    expect(typeof face?.end).toBe('number');

    // Check first track mapping
    const track = output.labelTracks[0];
    expect(track).toBeDefined();
    expect(track.trackHash).toBeDefined();
    expect(track.trackId).toBeDefined();
    expect(track.keyframes.length).toBeGreaterThan(0);
  });

  // GCVI omits the track id often, and the executor no longer stands in the
  // array index for it — that index would have re-keyed every face (and
  // stranded its manual tag) whenever a re-detect changed the ordering.
  it('derives trackless face ids from content, stable across ordering', async () => {
    const face = (start: number, left: number) => ({
      trackId: '',
      frames: [
        {
          timeOffset: start,
          boundingBox: { left, top: 0.1, right: left + 0.2, bottom: 0.4 },
          confidence: 0.9,
        },
        {
          timeOffset: start + 2,
          boundingBox: { left, top: 0.1, right: left + 0.2, bottom: 0.4 },
          confidence: 0.9,
        },
      ],
    });
    const a = face(0, 0.1);
    const b = face(4, 0.6);
    const run = (faces: unknown[]) =>
      normalizer.normalize({
        response: { faces },
        mediaId: 'media-1',
        workspaceRef: 'workspace-1',
        taskRef: 'task-1',
        version: 1,
        processor: 'face-detection',
        processorVersion: '1.0.0',
      } as NormalizerInput<any>);

    const first = await run([a, b]);
    const reordered = await run([b, a]);

    expect(new Set(first.labelEntities.map((e) => e.entityHash)).size).toBe(2);
    expect(new Set(reordered.labelEntities.map((e) => e.entityHash))).toEqual(
      new Set(first.labelEntities.map((e) => e.entityHash))
    );
  });

  it('should create LabelFace entities with attributes', async () => {
    const input: NormalizerInput<any> = {
      response: {
        faces: [
          {
            trackId: 'track-123',
            frames: [
              {
                timeOffset: 0,
                boundingBox: { left: 0, top: 0, right: 1, bottom: 1 },
                confidence: 0.9,
                attributes: {
                  headwearLikelihood: 'High',
                },
              },
            ],
          },
        ],
      },
      mediaId: 'media-1',
      workspaceRef: 'workspace-1',
      taskRef: 'task-1',
      version: 1,
      processor: 'face-detection',
      processorVersion: '1.0.0',
    };

    const output = await normalizer.normalize(input);

    expect(output.labelFaces?.length).toBe(1);
    const face = output.labelFaces?.[0];
    expect(face?.trackId).toBe('track-123');
    expect(face?.headwearLikelihood).toBe('High');

    // The same aggregated attributes are also mirrored as a standalone,
    // self-contained FaceAttributes object under metadata.
    const faceAttributes = (
      face?.metadata as { faceAttributes?: Record<string, unknown> }
    )?.faceAttributes;
    expect(faceAttributes).toBeDefined();
    expect(faceAttributes?.headwearLikelihood).toBe('High');
    // Only the present key is copied; absent likelihoods are omitted.
    expect(faceAttributes?.joyLikelihood).toBeUndefined();
  });

  it('should omit the standalone faceAttributes when none are present', async () => {
    const input: NormalizerInput<any> = {
      response: {
        faces: [
          {
            trackId: 'track-no-attrs',
            frames: [
              {
                timeOffset: 0,
                boundingBox: { left: 0, top: 0, right: 1, bottom: 1 },
                confidence: 0.9,
              },
            ],
          },
        ],
      },
      mediaId: 'media-1',
      workspaceRef: 'workspace-1',
      taskRef: 'task-1',
      version: 1,
      processor: 'face-detection',
      processorVersion: '1.0.0',
    };

    const output = await normalizer.normalize(input);

    const face = output.labelFaces?.[0];
    expect(face).toBeDefined();
    // Null-safe: no attributes → no faceAttributes key, metadata still valid.
    const metadata = face?.metadata as {
      processorVersion?: string;
      faceAttributes?: unknown;
    };
    expect(metadata?.processorVersion).toBeDefined();
    expect(metadata?.faceAttributes).toBeUndefined();
  });
});
