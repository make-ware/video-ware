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

    // Verify entity creation
    expect(output.labelEntities.length).toBe(1);
    expect(output.labelEntities[0].canonicalName).toBe('Face');

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
  });
});
