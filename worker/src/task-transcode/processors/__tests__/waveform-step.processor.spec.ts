import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MediaType } from '@project/shared';
import { WaveformStepProcessor } from '../waveform-step.processor';
import type { TaskTranscodeWaveformStep } from '@project/shared/jobs';

vi.mock('@nestjs/common', async () => {
  const actual = await vi.importActual('@nestjs/common');
  const { MockLogger } = await import('@/__mocks__/logger');
  return { ...actual, Logger: MockLogger };
});

vi.mock('../../utils/file-resolver', () => ({
  FileResolver: {
    resolveFilePath: vi.fn().mockResolvedValue('/local/source.mp4'),
    resolveOutputFilePath: (
      _ws: string,
      _upload: string,
      fileName: string
    ): string => `/local/out/${fileName}`,
  },
}));

const CONFIG = { width: 1000, height: 200, pixelsPerSecond: 1 };

function step(): TaskTranscodeWaveformStep {
  return {
    type: 'waveform',
    filePath: '',
    uploadId: 'upload-1',
    mediaId: 'media-1',
    config: CONFIG,
  };
}

/** A probed Media as the PROBE step leaves it. */
function media(overrides: Record<string, unknown> = {}) {
  return {
    id: 'media-1',
    mediaType: MediaType.VIDEO,
    duration: 2500,
    mediaData: { audio: { codec: 'aac', channels: 2, sampleRate: 48000 } },
    ...overrides,
  };
}

describe('WaveformStepProcessor', () => {
  let waveformExecutor: { execute: ReturnType<typeof vi.fn> };
  let storageService: { cleanup: ReturnType<typeof vi.fn> };
  let pocketbaseService: {
    getUpload: ReturnType<typeof vi.fn>;
    findMediaByUpload: ReturnType<typeof vi.fn>;
    uploadFile: ReturnType<typeof vi.fn>;
    updateMedia: ReturnType<typeof vi.fn>;
  };
  let processor: WaveformStepProcessor;

  beforeEach(() => {
    waveformExecutor = {
      execute: vi.fn(async (_path, outputPath, config, chunk) => ({
        outputPath,
        width: chunk.width,
        height: config.height,
        startTime: chunk.startTime,
        duration: chunk.duration,
        pixelsPerSecond: config.pixelsPerSecond,
      })),
    };
    storageService = { cleanup: vi.fn().mockResolvedValue(undefined) };
    pocketbaseService = {
      getUpload: vi.fn().mockResolvedValue({
        id: 'upload-1',
        WorkspaceRef: 'ws-1',
      }),
      findMediaByUpload: vi.fn().mockResolvedValue(media()),
      uploadFile: vi
        .fn()
        .mockImplementation(async ({ fileName }: { fileName: string }) => ({
          id: `file-${fileName}`,
        })),
      updateMedia: vi.fn().mockResolvedValue(undefined),
    };

    processor = new WaveformStepProcessor(
      waveformExecutor as never,
      { ...storageService, transcodeStorageKey: () => 'key' } as never,
      pocketbaseService as never
    );
  });

  it('renders one chunk per planned window and links them in order', async () => {
    const output = await processor.process(step(), {} as never);

    // 2500s at 1000px/1px-per-second: two full chunks and a 500s tail.
    expect(waveformExecutor.execute).toHaveBeenCalledTimes(3);
    expect(output.allWaveformFileIds).toEqual([
      'file-waveform_0.png',
      'file-waveform_1.png',
      'file-waveform_2.png',
    ]);
    expect(output.waveformFileId).toBe('file-waveform_0.png');
    expect(pocketbaseService.updateMedia).toHaveBeenCalledWith('media-1', {
      waveformFileRefs: output.allWaveformFileIds,
    });
  });

  it('stores what each chunk actually covers, not the request', async () => {
    await processor.process(step(), {} as never);

    const lastCall = pocketbaseService.uploadFile.mock.calls[2][0];
    expect(lastCall.meta.waveformConfig).toMatchObject({
      chunkIndex: 2,
      startTime: 2000,
      duration: 500,
      // The tail is narrower than the requested 1000px width.
      width: 500,
      height: 200,
      pixelsPerSecond: 1,
    });
  });

  it('cleans up every local image, including on failure', async () => {
    waveformExecutor.execute.mockRejectedValueOnce(new Error('ffmpeg died'));

    await expect(processor.process(step(), {} as never)).rejects.toThrow(
      'ffmpeg died'
    );
    expect(storageService.cleanup).toHaveBeenCalledWith(
      '/local/out/waveform_0.png'
    );
  });

  it('skips silent media', async () => {
    pocketbaseService.findMediaByUpload.mockResolvedValue(
      media({ mediaData: { duration: 10 } })
    );

    const output = await processor.process(step(), {} as never);

    expect(output.allWaveformFileIds).toEqual([]);
    expect(waveformExecutor.execute).not.toHaveBeenCalled();
    expect(pocketbaseService.updateMedia).not.toHaveBeenCalled();
  });

  it('skips images', async () => {
    pocketbaseService.findMediaByUpload.mockResolvedValue(
      media({ mediaType: MediaType.IMAGE, duration: 0 })
    );

    const output = await processor.process(step(), {} as never);

    expect(output.allWaveformFileIds).toEqual([]);
    expect(waveformExecutor.execute).not.toHaveBeenCalled();
  });

  it('skips media with no measurable duration', async () => {
    pocketbaseService.findMediaByUpload.mockResolvedValue(
      media({ duration: 0 })
    );

    const output = await processor.process(step(), {} as never);

    expect(output.allWaveformFileIds).toEqual([]);
    expect(waveformExecutor.execute).not.toHaveBeenCalled();
  });
});
