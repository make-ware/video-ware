import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Job } from 'bullmq';
import { MediaType, ProcessingProvider } from '@project/shared';
import type { TaskTranscodeTranscodeStep } from '@project/shared/jobs';
import { INGEST_STEP_VERSIONS, TranscodeStepType } from '@project/shared/jobs';
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

  it('records the probed proxy in the File meta', async () => {
    // First probe = the source; second = the proxy that was just written.
    probeExecutor.execute
      .mockResolvedValueOnce({
        probeOutput: {
          width: 1920,
          height: 1080,
          displayWidth: 1080,
          displayHeight: 1920,
          rotation: 90,
        },
      })
      .mockResolvedValueOnce({
        probeOutput: {
          duration: 61.4,
          width: 406,
          height: 720,
          displayWidth: 406,
          displayHeight: 720,
          rotation: 0,
          codec: 'h264',
          fps: 30,
          bitrate: 2_000_000,
          format: 'mov,mp4,m4a,3gp,3g2,mj2',
          size: 15_350_000,
          audio: { codec: 'aac', channels: 2, sampleRate: 48000 },
        },
      });

    await processor.process(input, job);

    expect(pocketbaseService.uploadFile.mock.calls[0][0].meta).toEqual({
      // Stamped by the ingest spec so the backfill can tell current from stale.
      ingestVersion: INGEST_STEP_VERSIONS[TranscodeStepType.TRANSCODE],
      mimeType: 'video/mp4',
      duration: 61.4,
      width: 406,
      height: 720,
      fps: 30,
      codec: 'h264',
      bitrate: 2_000_000,
      format: 'mov,mp4,m4a,3gp,3g2,mj2',
      size: 15_350_000,
      channels: 2,
      sampleRate: 48000,
    });
  });

  it('still stores the proxy when probing the output fails', async () => {
    probeExecutor.execute
      .mockResolvedValueOnce({
        probeOutput: { width: 1920, height: 1080, rotation: 0 },
      })
      .mockRejectedValueOnce(new Error('ffprobe gone'));

    const result = await processor.process(input, job);

    expect(result.proxyFileId).toBe('proxy-new');
    expect(pocketbaseService.uploadFile.mock.calls[0][0].meta).toEqual({
      ingestVersion: INGEST_STEP_VERSIONS[TranscodeStepType.TRANSCODE],
      mimeType: 'video/mp4',
    });
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
