import { describe, it, expect, vi } from 'vitest';
import type { Job } from 'bullmq';
import { MediaType } from '@project/shared';
import { INGEST_STEP_VERSIONS, TranscodeStepType } from '@project/shared/jobs';
import type { StepJobData } from '../../../queue/types/job.types';
import { FilmstripStepProcessor } from '../filmstrip-step.processor';
import { SpriteStepProcessor } from '../sprite-step.processor';
import { ThumbnailStepProcessor } from '../thumbnail-step.processor';
import { AudioStepProcessor } from '../audio-step.processor';
import { FFmpegSpriteExecutor } from '../../executors/ffmpeg/sprite.executor';
import { FFmpegThumbnailExecutor } from '../../executors/ffmpeg/thumbnail.executor';

vi.mock('@nestjs/common', async () => {
  const actual = await vi.importActual('@nestjs/common');
  const { MockLogger } = await import('@/__mocks__/logger');
  return { ...actual, Logger: MockLogger };
});

const job = {} as Job<StepJobData>;

/**
 * A portrait phone clip: coded 1920x1080 with a 90° display matrix, so every
 * generated asset is 1080x1920 — the case where copying the request into meta
 * (tileWidth 320 / tileHeight 180) recorded a shape the pixels never had.
 */
const rotatedPortraitMedia = {
  id: 'm-1',
  mediaType: MediaType.VIDEO,
  duration: 42,
  width: 1920,
  height: 1080,
  rotation: 90,
  aspectRatio: 1920 / 1080,
  mediaData: {
    width: 1920,
    height: 1080,
    displayWidth: 1080,
    displayHeight: 1920,
    rotation: 90,
    audio: true,
  },
};

function services(media: Record<string, unknown> = rotatedPortraitMedia) {
  return {
    storageService: {
      getBasePath: vi.fn().mockReturnValue('/data'),
      transcodeStorageKey: vi.fn().mockReturnValue('transcode/key/out'),
      cleanup: vi.fn().mockResolvedValue(undefined),
    },
    pocketbaseService: {
      getUpload: vi
        .fn()
        .mockResolvedValue({ id: 'up-1', WorkspaceRef: 'ws-1' }),
      findMediaByUpload: vi.fn().mockResolvedValue(media),
      uploadFile: vi.fn().mockResolvedValue({ id: 'file-1' }),
      updateMedia: vi.fn().mockResolvedValue(undefined),
      getFile: vi.fn().mockResolvedValue(null),
    },
  };
}

/** meta of the nth uploaded File. */
function uploadedMeta(pocketbaseService: any, index = 0) {
  return pocketbaseService.uploadFile.mock.calls[index][0].meta;
}

describe('FilmstripStepProcessor meta', () => {
  it('records the geometry the strip was built with, not the requested one', async () => {
    const { storageService, pocketbaseService } = services();
    const ffmpegService = {
      generateSprite: vi.fn().mockResolvedValue(undefined),
    };
    const processor = new FilmstripStepProcessor(
      new FFmpegSpriteExecutor(ffmpegService as never),
      storageService as never,
      pocketbaseService as never
    );

    await processor.process(
      {
        type: 'filmstrip',
        uploadId: 'up-1',
        filePath: '/data/uploads/ws-1/up-1/original.mov',
        config: { cols: 100, rows: 1, tileWidth: 320, tileHeight: 180 },
      } as never,
      job
    );

    const meta = uploadedMeta(pocketbaseService);
    expect(meta.filmstripConfig).toEqual({
      cols: 100,
      rows: 1,
      tileWidth: 320,
      tileHeight: 570,
      segmentIndex: 0,
      startTime: 0,
      fps: 1,
    });
    // Sheet dimensions follow from the same numbers.
    expect(meta).toMatchObject({ width: 32000, height: 570 });

    // ...and those are the dimensions ffmpeg scaled to.
    const [, , , , , tileWidth, tileHeight] =
      ffmpegService.generateSprite.mock.calls[0];
    expect({ tileWidth, tileHeight }).toEqual({
      tileWidth: 320,
      tileHeight: 570,
    });
  });

  it('stamps each segment with its own index and start time', async () => {
    const { storageService, pocketbaseService } = services({
      ...rotatedPortraitMedia,
      duration: 250, // 3 segments of 100s
    });
    const processor = new FilmstripStepProcessor(
      new FFmpegSpriteExecutor({
        generateSprite: vi.fn().mockResolvedValue(undefined),
      } as never),
      storageService as never,
      pocketbaseService as never
    );

    await processor.process(
      {
        type: 'filmstrip',
        uploadId: 'up-1',
        filePath: '/in.mov',
        config: { cols: 100, rows: 1, tileWidth: 320 },
      } as never,
      job
    );

    expect(pocketbaseService.uploadFile).toHaveBeenCalledTimes(3);
    expect(
      [0, 1, 2].map((i) => uploadedMeta(pocketbaseService, i).filmstripConfig)
    ).toEqual([
      expect.objectContaining({ segmentIndex: 0, startTime: 0 }),
      expect.objectContaining({ segmentIndex: 1, startTime: 100 }),
      expect.objectContaining({ segmentIndex: 2, startTime: 200 }),
    ]);
  });
});

describe('SpriteStepProcessor meta', () => {
  it('records the real tile geometry and sheet size', async () => {
    const { storageService, pocketbaseService } = services();
    const processor = new SpriteStepProcessor(
      { execute: vi.fn() } as never, // probe executor (unused here)
      new FFmpegSpriteExecutor({
        generateSprite: vi.fn().mockResolvedValue(undefined),
      } as never),
      storageService as never,
      pocketbaseService as never
    );

    await processor.process(
      {
        type: 'sprite',
        uploadId: 'up-1',
        filePath: '/in.mov',
        config: { fps: 1, cols: 10, rows: 10, tileWidth: 320, tileHeight: 180 },
      } as never,
      job
    );

    const meta = uploadedMeta(pocketbaseService);
    expect(meta.spriteConfig).toMatchObject({
      cols: 10,
      rows: 10,
      tileWidth: 320,
      tileHeight: 570,
    });
    expect(meta).toMatchObject({ width: 3200, height: 5700 });
  });
});

describe('ThumbnailStepProcessor meta', () => {
  it('records the fitted image size, not the requested box', async () => {
    const { storageService, pocketbaseService } = services();
    const ffmpegService = {
      generateThumbnail: vi.fn().mockResolvedValue(undefined),
    };
    const processor = new ThumbnailStepProcessor(
      { execute: vi.fn() } as never,
      new FFmpegThumbnailExecutor(ffmpegService as never),
      storageService as never,
      pocketbaseService as never
    );

    await processor.process(
      {
        type: 'thumbnail',
        uploadId: 'up-1',
        filePath: '/in.mov',
        config: { timestamp: 'midpoint', width: 640, height: 360 },
      } as never,
      job
    );

    // 1080x1920 fitted into the 640x360 box -> 204x360 (even), not 640x360.
    expect(uploadedMeta(pocketbaseService)).toMatchObject({
      width: 204,
      height: 360,
      mimeType: 'image/jpeg',
    });
    const [, , , width, height] = ffmpegService.generateThumbnail.mock.calls[0];
    expect({ width, height }).toEqual({ width: 204, height: 360 });
  });
});

describe('AudioStepProcessor meta', () => {
  const audioInput = {
    type: 'audio',
    uploadId: 'up-1',
    filePath: '/in.mov',
    format: 'mp3',
  };

  it('records probed facts about the extracted track', async () => {
    const { storageService, pocketbaseService } = services();
    const processor = new AudioStepProcessor(
      {
        execute: vi.fn().mockResolvedValue({ outputPath: '/out.mp3' }),
      } as never,
      {
        execute: vi.fn().mockResolvedValue({
          probeOutput: {
            duration: 41.98,
            width: 0,
            height: 0,
            displayWidth: 0,
            displayHeight: 0,
            codec: 'mp3',
            fps: 0,
            bitrate: 128000,
            format: 'mp3',
            size: 671680,
            audio: { codec: 'mp3', channels: 2, sampleRate: 48000 },
          },
        }),
      } as never,
      storageService as never,
      pocketbaseService as never
    );

    await processor.process(audioInput as never, job);

    expect(uploadedMeta(pocketbaseService)).toEqual({
      // Stamped by the ingest spec so the backfill can tell current from stale.
      ingestVersion: INGEST_STEP_VERSIONS[TranscodeStepType.AUDIO],
      mimeType: 'audio/mpeg',
      duration: 41.98,
      codec: 'mp3',
      format: 'mp3',
      bitrate: 128000,
      size: 671680,
      channels: 2,
      sampleRate: 48000,
    });
  });

  it('still stores the file when probing the output fails', async () => {
    const { storageService, pocketbaseService } = services();
    const processor = new AudioStepProcessor(
      {
        execute: vi.fn().mockResolvedValue({ outputPath: '/out.mp3' }),
      } as never,
      {
        execute: vi.fn().mockRejectedValue(new Error('ffprobe gone')),
      } as never,
      storageService as never,
      pocketbaseService as never
    );

    const result = await processor.process(audioInput as never, job);

    expect(result.audioFileId).toBe('file-1');
    expect(uploadedMeta(pocketbaseService)).toEqual({
      ingestVersion: INGEST_STEP_VERSIONS[TranscodeStepType.AUDIO],
      mimeType: 'audio/mpeg',
    });
  });
});
