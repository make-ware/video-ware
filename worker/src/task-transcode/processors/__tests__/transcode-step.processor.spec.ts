import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Job } from 'bullmq';
import { MediaType, ProcessingProvider } from '@project/shared';
import type { TaskTranscodeTranscodeStep } from '@project/shared/jobs';
import { TranscodeStepProcessor } from '../transcode-step.processor';
import type { StepJobData } from '../../../queue/types/job.types';

// Mock Logger
vi.mock('@nestjs/common', async () => {
  const actual = await vi.importActual('@nestjs/common');
  const { MockLogger } = await import('@/__mocks__/logger');
  return {
    ...actual,
    Logger: MockLogger,
  };
});

describe('TranscodeStepProcessor - superseded proxy cleanup', () => {
  let processor: TranscodeStepProcessor;
  let probeExecutor: any;
  let ffmpegTranscodeExecutor: any;
  let googleTranscodeExecutor: any;
  let storageService: any;
  let pocketbaseService: any;

  const input: TaskTranscodeTranscodeStep = {
    type: 'transcode',
    filePath: '/data/uploads/ws-1/up-1/original.mov',
    uploadId: 'up-1',
    provider: ProcessingProvider.FFMPEG,
    config: { resolution: '720p', codec: 'h264' },
  } as TaskTranscodeTranscodeStep;

  const job = {} as Job<StepJobData>;

  const media = (proxyFileRef?: string) => ({
    id: 'm-1',
    mediaType: MediaType.VIDEO,
    proxyFileRef,
  });

  beforeEach(() => {
    probeExecutor = {
      execute: vi.fn().mockResolvedValue({
        probeOutput: {
          width: 1920,
          height: 1080,
          displayWidth: 1920,
          displayHeight: 1080,
          rotation: 0,
        },
      }),
    };
    ffmpegTranscodeExecutor = {
      execute: vi.fn().mockResolvedValue({ outputPath: 'out' }),
    };
    googleTranscodeExecutor = { execute: vi.fn() };
    storageService = {
      getBasePath: vi.fn().mockReturnValue('/data'),
      transcodeStorageKey: vi.fn().mockReturnValue('transcode/key/proxy.mp4'),
      cleanup: vi.fn().mockResolvedValue(undefined),
    };
    pocketbaseService = {
      getUpload: vi
        .fn()
        .mockResolvedValue({ id: 'up-1', WorkspaceRef: 'ws-1' }),
      findMediaByUpload: vi.fn().mockResolvedValue(media('proxy-old')),
      logUsageEvent: vi.fn().mockResolvedValue(undefined),
      uploadFile: vi.fn().mockResolvedValue({ id: 'proxy-new' }),
      updateMedia: vi.fn().mockResolvedValue(undefined),
      deleteFile: vi.fn().mockResolvedValue(true),
    };

    processor = new TranscodeStepProcessor(
      probeExecutor,
      ffmpegTranscodeExecutor,
      googleTranscodeExecutor,
      storageService,
      pocketbaseService
    );
  });

  it('deletes the superseded proxy after repointing the Media', async () => {
    const result = await processor.process(input, job);

    expect(result.proxyFileId).toBe('proxy-new');
    expect(pocketbaseService.updateMedia).toHaveBeenCalledWith('m-1', {
      proxyFileRef: 'proxy-new',
    });
    expect(pocketbaseService.deleteFile).toHaveBeenCalledWith('proxy-old');

    // The old proxy must only be deleted once the Media points at the new one.
    const updateOrder =
      pocketbaseService.updateMedia.mock.invocationCallOrder[0];
    const deleteOrder =
      pocketbaseService.deleteFile.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(deleteOrder);
  });

  it('does not delete anything on a first transcode (no prior proxy)', async () => {
    pocketbaseService.findMediaByUpload.mockResolvedValue(media(undefined));

    await processor.process(input, job);

    expect(pocketbaseService.updateMedia).toHaveBeenCalledWith('m-1', {
      proxyFileRef: 'proxy-new',
    });
    expect(pocketbaseService.deleteFile).not.toHaveBeenCalled();
  });

  it('keeps the old proxy when repointing the Media fails', async () => {
    pocketbaseService.updateMedia.mockRejectedValue(new Error('pb down'));

    await expect(processor.process(input, job)).rejects.toThrow('pb down');

    expect(pocketbaseService.deleteFile).not.toHaveBeenCalled();
    // Local output cleanup still runs on failure.
    expect(storageService.cleanup).toHaveBeenCalled();
  });
});
