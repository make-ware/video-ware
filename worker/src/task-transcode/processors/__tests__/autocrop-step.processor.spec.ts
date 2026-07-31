import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Job } from 'bullmq';
import { MediaType, type CropSuggestion } from '@project/shared';
import type { TaskTranscodeAutoCropStep } from '@project/shared/jobs';
import { AutoCropStepProcessor } from '../autocrop-step.processor';
import type { StepJobData } from '../../../queue/types/job.types';

vi.mock('@nestjs/common', async () => {
  const actual = await vi.importActual('@nestjs/common');
  const { MockLogger } = await import('@/__mocks__/logger');
  return { ...actual, Logger: MockLogger };
});

/** 1920x1080 with 140px bars top and bottom — a 2.40:1 letterbox. */
const LETTERBOX_BOX = { width: 1920, height: 800, x: 0, y: 140 };
const LETTERBOX_RECT = {
  left: 0,
  top: 140 / 1080,
  width: 1,
  height: 800 / 1080,
};

describe('AutoCropStepProcessor', () => {
  let processor: AutoCropStepProcessor;
  let autoCropExecutor: any;
  let probeExecutor: any;
  let storageService: any;
  let pocketbaseService: any;

  const input: TaskTranscodeAutoCropStep = {
    type: 'autocrop',
    filePath: '/data/uploads/ws-1/up-1/original.mov',
    uploadId: 'up-1',
    mediaId: 'm-1',
    config: { enabled: true },
  };

  const job = {} as Job<StepJobData>;

  const media = (over: Record<string, unknown> = {}) => ({
    id: 'm-1',
    mediaType: MediaType.VIDEO,
    ...over,
  });

  /** The single Media patch the step wrote. */
  const written = () => pocketbaseService.updateMedia.mock.calls[0][1];

  beforeEach(() => {
    autoCropExecutor = {
      execute: vi
        .fn()
        .mockResolvedValue({ boxes: [LETTERBOX_BOX], attempted: 5, limit: 24 }),
    };
    probeExecutor = {
      execute: vi.fn().mockResolvedValue({
        probeOutput: {
          duration: 120,
          width: 1920,
          height: 1080,
          displayWidth: 1920,
          displayHeight: 1080,
          rotation: 0,
        },
      }),
    };
    storageService = { getBasePath: vi.fn().mockReturnValue('/data') };
    pocketbaseService = {
      findMediaByUpload: vi.fn().mockResolvedValue(media()),
      updateMedia: vi.fn().mockResolvedValue(undefined),
      getUpload: vi
        .fn()
        .mockResolvedValue({ id: 'up-1', WorkspaceRef: 'ws-1' }),
    };

    processor = new AutoCropStepProcessor(
      autoCropExecutor,
      probeExecutor,
      storageService,
      pocketbaseService
    );
  });

  it('stores the suggestion and applies the crop to the media', async () => {
    const result = await processor.process(input, job);

    expect(result.applied).toBe(true);
    const patch = written();
    expect(patch.crop).toEqual(LETTERBOX_RECT);
    expect(patch.cropSuggestion).toMatchObject({
      rect: LETTERBOX_RECT,
      pixels: LETTERBOX_BOX,
      displayWidth: 1920,
      displayHeight: 1080,
      samples: 1,
      attempted: 5,
      applied: true,
      limit: 24,
    });
    expect(patch.cropSuggestion.skipReason).toBeUndefined();
    expect(result.cropSuggestion).toEqual(patch.cropSuggestion);
  });

  it('records a skipped suggestion without touching the crop', async () => {
    autoCropExecutor.execute.mockResolvedValue({
      boxes: [{ width: 1920, height: 1080, x: 0, y: 0 }],
      attempted: 5,
      limit: 24,
    });

    const result = await processor.process(input, job);

    expect(result.applied).toBe(false);
    const patch = written();
    expect(patch).not.toHaveProperty('crop');
    expect(patch.cropSuggestion).toMatchObject({
      applied: false,
      skipReason: 'full-frame',
    });
  });

  it("leaves a human's crop alone and says why", async () => {
    pocketbaseService.findMediaByUpload.mockResolvedValue(
      media({ crop: { left: 0.1, top: 0.1, width: 0.5, height: 0.5 } })
    );

    const result = await processor.process(input, job);

    expect(result.applied).toBe(false);
    const patch = written();
    expect(patch).not.toHaveProperty('crop');
    expect(patch.cropSuggestion.skipReason).toBe('manual-crop');
  });

  it('re-applies over a crop from its own previous suggestion', async () => {
    const previous: CropSuggestion = {
      rect: LETTERBOX_RECT,
      pixels: LETTERBOX_BOX,
      displayWidth: 1920,
      displayHeight: 1080,
      samples: 5,
      attempted: 5,
      agreement: 1,
      applied: true,
      limit: 24,
      detectedAt: '2026-01-01T00:00:00.000Z',
    };
    pocketbaseService.findMediaByUpload.mockResolvedValue(
      media({ crop: LETTERBOX_RECT, cropSuggestion: previous })
    );
    autoCropExecutor.execute.mockResolvedValue({
      boxes: [{ width: 1920, height: 760, x: 0, y: 160 }],
      attempted: 5,
      limit: 24,
    });

    const result = await processor.process(input, job);

    expect(result.applied).toBe(true);
    expect(written().crop).toEqual({
      left: 0,
      top: 160 / 1080,
      width: 1,
      height: 760 / 1080,
    });
  });

  it('unions the sampled boxes rather than trusting any one of them', async () => {
    autoCropExecutor.execute.mockResolvedValue({
      boxes: [
        { width: 1920, height: 800, x: 0, y: 140 },
        { width: 1900, height: 840, x: 10, y: 120 },
      ],
      attempted: 5,
      limit: 24,
    });

    await processor.process(input, job);

    expect(written().cropSuggestion.pixels).toEqual({
      x: 0,
      y: 120,
      width: 1920,
      height: 840,
    });
  });

  it('does not count all-black windows as samples', async () => {
    autoCropExecutor.execute.mockResolvedValue({
      boxes: [LETTERBOX_BOX, { width: -1, height: -1, x: -1, y: -1 }],
      attempted: 5,
      limit: 24,
    });

    await processor.process(input, job);

    const suggestion = written().cropSuggestion;
    expect(suggestion.samples).toBe(1);
    expect(suggestion.attempted).toBe(5);
    // The lone real box IS the union, so it agrees with it completely.
    expect(suggestion.agreement).toBe(1);
    expect(suggestion.pixels).toEqual({
      x: 0,
      y: 140,
      width: 1920,
      height: 800,
    });
  });

  it('normalizes against the DISPLAY frame of a rotated source', async () => {
    // Coded 1920x1080 with a 90° matrix decodes to 1080x1920, and cropdetect
    // reports in that upright space.
    probeExecutor.execute.mockResolvedValue({
      probeOutput: {
        duration: 120,
        width: 1920,
        height: 1080,
        displayWidth: 1080,
        displayHeight: 1920,
        rotation: 90,
      },
    });
    autoCropExecutor.execute.mockResolvedValue({
      boxes: [{ width: 1080, height: 1600, x: 0, y: 160 }],
      attempted: 5,
      limit: 24,
    });

    await processor.process(input, job);

    const suggestion = written().cropSuggestion;
    expect(suggestion.displayWidth).toBe(1080);
    expect(suggestion.displayHeight).toBe(1920);
    expect(suggestion.rect).toEqual({
      left: 0,
      top: 160 / 1920,
      width: 1,
      height: 1600 / 1920,
    });
  });

  it('skips non-video media without running ffmpeg', async () => {
    for (const mediaType of [MediaType.AUDIO, MediaType.IMAGE]) {
      pocketbaseService.updateMedia.mockClear();
      autoCropExecutor.execute.mockClear();
      pocketbaseService.findMediaByUpload.mockResolvedValue(
        media({ mediaType })
      );

      const result = await processor.process(input, job);

      expect(result).toEqual({ applied: false });
      expect(autoCropExecutor.execute).not.toHaveBeenCalled();
      expect(pocketbaseService.updateMedia).not.toHaveBeenCalled();
    }
  });

  it('writes nothing when no window produced a usable box', async () => {
    autoCropExecutor.execute.mockResolvedValue({
      boxes: [],
      attempted: 5,
      limit: 24,
    });

    const result = await processor.process(input, job);

    expect(result).toEqual({ applied: false });
    expect(pocketbaseService.updateMedia).not.toHaveBeenCalled();
  });

  it('skips detection when the display frame is unknown', async () => {
    probeExecutor.execute.mockResolvedValue({
      probeOutput: { duration: 120, width: 0, height: 0 },
    });

    const result = await processor.process(input, job);

    expect(result).toEqual({ applied: false });
    expect(autoCropExecutor.execute).not.toHaveBeenCalled();
    expect(pocketbaseService.updateMedia).not.toHaveBeenCalled();
  });

  it('passes configured sampling and thresholds through', async () => {
    await processor.process(
      {
        ...input,
        config: {
          enabled: true,
          limit: 40,
          samples: 9,
          sampleDuration: 3,
          sampleFps: 5,
          // A trim this large means the 26% letterbox no longer qualifies.
          minTrimFraction: 0.5,
        },
      },
      job
    );

    expect(autoCropExecutor.execute).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        limit: 40,
        samples: 9,
        sampleDuration: 3,
        sampleFps: 5,
        durationSec: 120,
      })
    );
    expect(written().cropSuggestion.skipReason).toBe('below-threshold');
  });

  it('throws when the media record is missing', async () => {
    pocketbaseService.findMediaByUpload.mockResolvedValue(null);

    await expect(processor.process(input, job)).rejects.toThrow(
      /Media not found/
    );
  });
});
