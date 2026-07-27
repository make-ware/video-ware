import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Job } from 'bullmq';
import { LabelType, ProcessingProvider } from '@project/shared';
import { LabelDetectionStepProcessor } from '../label-detection-step.processor';
import type { StepJobData } from '../../../queue/types/job.types';
import type { LabelDetectionStepInput } from '../../types/step-inputs';

// Mock Logger
vi.mock('@nestjs/common', async () => {
  const actual = await vi.importActual('@nestjs/common');
  const { MockLogger } = await import('@/__mocks__/logger');
  return {
    ...actual,
    Logger: MockLogger,
  };
});

/**
 * The write phase of LABEL_DETECTION.
 *
 * Shots and segments have no provider track, so their entity is the label
 * CLASS within the media: the row is keyed by its own hash, the entity by the
 * normalized label name, and every "mountain" interval shares one entity and
 * one tag. That link is the only thing standing between a detected segment and
 * a real-world Entity — a row written without one is unlinkable, and because
 * the row's hash is stable, re-running the task would find it and leave it that
 * way forever.
 */
describe('LabelDetectionStepProcessor - persisting segments and shots', () => {
  let processor: LabelDetectionStepProcessor;
  let labelEntityService: any;
  let normalizer: any;
  let pocketBaseService: any;
  let segmentMutator: any;
  let shotMutator: any;

  const input: LabelDetectionStepInput = {
    type: 'label_detection',
    mediaId: 'media-1',
    workspaceRef: 'ws-1',
    taskRef: 'task-1',
    version: 1,
    fileRef: 'gs://bucket/media-1.mp4',
    config: {},
  } as LabelDetectionStepInput;

  /** One segment and one shot — the shape the normalizer emits. */
  const normalized = () => ({
    labelEntities: [
      {
        WorkspaceRef: 'ws-1',
        MediaRef: 'media-1',
        labelType: LabelType.SEGMENT,
        canonicalName: 'wilderness',
        instanceId: 'wilderness',
        provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        processor: 'label-detection:1.1.0',
        entityHash: 'ws-1:media-1:segment:wilderness:gvi',
        metadata: {},
      },
      {
        WorkspaceRef: 'ws-1',
        MediaRef: 'media-1',
        labelType: LabelType.SHOT,
        canonicalName: 'mountain',
        instanceId: 'mountain',
        provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        processor: 'label-detection:1.1.0',
        entityHash: 'ws-1:media-1:shot:mountain:gvi',
        metadata: {},
      },
    ],
    labelTracks: [],
    labelClips: [],
    labelSegments: [
      {
        WorkspaceRef: 'ws-1',
        MediaRef: 'media-1',
        entity: 'wilderness',
        segmentHash: 'segment-hash-1',
        labelType: LabelType.SEGMENT,
        start: 0,
        end: 5,
        duration: 5,
        confidence: 0.9,
        version: 1,
        metadata: {},
      },
    ],
    labelShots: [
      {
        WorkspaceRef: 'ws-1',
        MediaRef: 'media-1',
        entity: 'mountain',
        shotHash: 'shot-hash-1',
        labelType: LabelType.SHOT,
        start: 0,
        end: 2,
        duration: 2,
        confidence: 0.8,
        version: 1,
        metadata: {},
      },
      {
        // Same label, later in the video: one entity covers both.
        WorkspaceRef: 'ws-1',
        MediaRef: 'media-1',
        entity: 'Mountain',
        shotHash: 'shot-hash-2',
        labelType: LabelType.SHOT,
        start: 6,
        end: 8,
        duration: 2,
        confidence: 0.7,
        version: 1,
        metadata: {},
      },
    ],
    labelMediaUpdate: {
      segmentLabelCount: 1,
      shotLabelCount: 2,
      shotCount: 1,
    },
  });

  beforeEach(() => {
    segmentMutator = {
      getFirstByFilter: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'segment-rec-1' }),
      update: vi.fn().mockResolvedValue({}),
    };
    shotMutator = {
      getFirstByFilter: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'shot-rec-1' }),
      update: vi.fn().mockResolvedValue({}),
    };

    labelEntityService = {
      // Mirrors the real service: one entity per instance, keyed by the
      // normalized label name for these two trackless types.
      resolveEntities: vi
        .fn()
        .mockImplementation(
          async (entities: Array<{ instanceId: string }>) =>
            new Map(
              entities.map((e) => [e.instanceId, `entity-rec-${e.instanceId}`])
            )
        ),
    };

    normalizer = { normalize: vi.fn().mockResolvedValue(normalized()) };

    pocketBaseService = {
      getMedia: vi.fn().mockResolvedValue({ id: 'media-1', duration: 10 }),
      logUsageEvent: vi.fn().mockResolvedValue(undefined),
      labelSegmentMutator: segmentMutator,
      labelShotMutator: shotMutator,
    };

    processor = new LabelDetectionStepProcessor(
      {
        getCachedLabels: vi.fn().mockResolvedValue(null),
        isCacheValid: vi.fn().mockReturnValue(false),
        storeLabelCache: vi.fn().mockResolvedValue(undefined),
      } as any,
      labelEntityService,
      {
        execute: vi
          .fn()
          .mockResolvedValue({ segmentLabels: [], shotLabels: [], shots: [] }),
      } as any,
      normalizer,
      pocketBaseService
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const runProcess = () => processor.process(input, {} as Job<StepJobData>);

  it('links new segment and shot rows to their label class entity', async () => {
    const result = await runProcess();

    expect(segmentMutator.create).toHaveBeenCalledWith(
      expect.objectContaining({
        segmentHash: 'segment-hash-1',
        LabelEntityRef: 'entity-rec-wilderness',
      })
    );
    expect(shotMutator.create).toHaveBeenCalledWith(
      expect.objectContaining({
        shotHash: 'shot-hash-1',
        LabelEntityRef: 'entity-rec-mountain',
      })
    );
    expect(result.counts.labelSegmentCount).toBe(1);
    expect(result.counts.labelShotCount).toBe(2);
  });

  it('gives both intervals of one label the same entity, whatever the casing', async () => {
    // The reason the entity is keyed by class rather than by row: tagging
    // "mountain" in this media is one action, not one per interval — and one
    // LabelEntity row, not hundreds on a dense video.
    await runProcess();

    const refs = shotMutator.create.mock.calls.map(
      (call: [{ LabelEntityRef: string }]) => call[0].LabelEntityRef
    );
    expect(refs).toEqual(['entity-rec-mountain', 'entity-rec-mountain']);
  });

  it('skips a segment whose entity did not resolve instead of writing an empty link', async () => {
    // The shot's entity resolves, the segment's does not — the failure must
    // not spread, and the segment must not land as an unlinkable row.
    labelEntityService.resolveEntities.mockResolvedValue(
      new Map([['mountain', 'entity-rec-mountain']])
    );

    const result = await runProcess();

    expect(segmentMutator.create).not.toHaveBeenCalled();
    expect(result.counts.labelSegmentCount).toBe(0);
    expect(shotMutator.create).toHaveBeenCalledWith(
      expect.objectContaining({ LabelEntityRef: 'entity-rec-mountain' })
    );
    expect(result.counts.labelShotCount).toBe(2);
  });

  it('repoints a hash-matched row that still points at a stale entity', async () => {
    // What a re-run looks like for rows written before entities became
    // per-instance: the content hash still matches, so the row is reused —
    // but its link is to the old shared-by-name entity.
    segmentMutator.getFirstByFilter.mockResolvedValue({
      id: 'segment-rec-1',
      LabelEntityRef: 'entity-rec-legacy-shared',
    });
    shotMutator.getFirstByFilter.mockResolvedValue({
      id: 'shot-rec-1',
      LabelEntityRef: undefined,
    });

    const result = await runProcess();

    expect(segmentMutator.create).not.toHaveBeenCalled();
    expect(segmentMutator.update).toHaveBeenCalledWith('segment-rec-1', {
      LabelEntityRef: 'entity-rec-wilderness',
    });
    expect(shotMutator.update).toHaveBeenCalledWith('shot-rec-1', {
      LabelEntityRef: 'entity-rec-mountain',
    });
    expect(result.counts.labelSegmentCount).toBe(1);
    expect(result.counts.labelShotCount).toBe(2);
  });

  it('writes nothing when an existing row already points at the right entity', async () => {
    segmentMutator.getFirstByFilter.mockResolvedValue({
      id: 'segment-rec-1',
      LabelEntityRef: 'entity-rec-wilderness',
    });
    shotMutator.getFirstByFilter.mockResolvedValue({
      id: 'shot-rec-1',
      LabelEntityRef: 'entity-rec-mountain',
    });

    const result = await runProcess();

    expect(segmentMutator.update).not.toHaveBeenCalled();
    expect(shotMutator.update).not.toHaveBeenCalled();
    expect(segmentMutator.create).not.toHaveBeenCalled();
    expect(shotMutator.create).not.toHaveBeenCalled();
    expect(result.counts.labelSegmentCount).toBe(1);
    expect(result.counts.labelShotCount).toBe(2);
  });
});
