import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Job } from 'bullmq';
import { FileStatus } from '@project/shared';
import { SpeakerTranscriptionStepProcessor } from '../speaker-transcription-step.processor';
import type { StepJobData } from '../../../queue/types/job.types';
import type { SpeakerTranscriptionStepInput } from '../../types/step-inputs';

// Mock Logger
vi.mock('@nestjs/common', async () => {
  const actual = await vi.importActual('@nestjs/common');
  const { MockLogger } = await import('@/__mocks__/logger');
  return {
    ...actual,
    Logger: MockLogger,
  };
});

describe('SpeakerTranscriptionStepProcessor - audio proxy resolution', () => {
  let processor: SpeakerTranscriptionStepProcessor;
  let tempDir: string;
  let labelCacheService: any;
  let labelEntityService: any;
  let executor: any;
  let normalizer: any;
  let pocketBaseService: any;
  let storageService: any;

  const input: SpeakerTranscriptionStepInput = {
    type: 'speaker_transcription',
    mediaId: 'media-1',
    workspaceRef: 'ws-1',
    taskRef: 'task-1',
    version: 1,
    fileRef: 'uploads/ws-1/up-1/video.mp4',
    config: {},
  };

  const audioFile = {
    id: 'file-audio-1',
    name: 'audio.mp3',
    file: 'audio_x1y2z3.mp3',
    fileStatus: FileStatus.AVAILABLE,
  };

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'speaker-proxy-spec-')
    );

    labelCacheService = {
      getCachedLabels: vi.fn().mockResolvedValue(null),
      isCacheValid: vi.fn().mockReturnValue(false),
      storeLabelCache: vi.fn().mockResolvedValue(undefined),
    };
    labelEntityService = {
      getOrCreateLabelEntity: vi.fn(),
      clearCache: vi.fn(),
    };
    executor = {
      execute: vi.fn().mockResolvedValue({
        transcript: 'hello',
        languageCode: 'en',
        languageProbability: 1,
        words: [],
      }),
    };
    normalizer = {
      normalize: vi.fn().mockResolvedValue({
        labelEntities: [],
        labelTracks: [],
        labelSpeakers: [],
        labelMediaUpdate: {},
      }),
    };
    pocketBaseService = {
      getMedia: vi.fn().mockResolvedValue({
        id: 'media-1',
        hasAudio: true,
        audioFileRef: audioFile.id,
      }),
      getFile: vi.fn().mockResolvedValue(audioFile),
      downloadFileToPath: vi
        .fn()
        .mockImplementation(async (_file: unknown, destPath: string) => {
          await fs.promises.writeFile(destPath, 'audio-bytes');
          return destPath;
        }),
    };
    storageService = {
      createTempDir: vi.fn().mockResolvedValue(tempDir),
    };

    processor = new SpeakerTranscriptionStepProcessor(
      labelCacheService,
      labelEntityService,
      executor,
      normalizer,
      pocketBaseService,
      storageService
    );
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  const runProcess = () => processor.process(input, {} as Job<StepJobData>);

  it('passes the downloaded audio proxy path to the executor', async () => {
    const result = await runProcess();

    const expectedPath = path.join(
      tempDir,
      `${audioFile.id}-${audioFile.name}`
    );
    expect(pocketBaseService.downloadFileToPath).toHaveBeenCalledWith(
      audioFile,
      expectedPath
    );
    expect(executor.execute).toHaveBeenCalledWith(
      input.workspaceRef,
      input.mediaId,
      input.fileRef,
      input.config,
      expectedPath
    );
    expect(result.success).toBe(true);
  });

  it('falls back to the original file when Media has no audioFileRef', async () => {
    pocketBaseService.getMedia.mockResolvedValue({
      id: 'media-1',
      hasAudio: true,
    });

    await runProcess();

    expect(pocketBaseService.getFile).not.toHaveBeenCalled();
    expect(executor.execute).toHaveBeenCalledWith(
      input.workspaceRef,
      input.mediaId,
      input.fileRef,
      input.config,
      undefined
    );
  });

  it('falls back when the audio proxy File record is missing', async () => {
    pocketBaseService.getFile.mockResolvedValue(null);

    await runProcess();

    expect(pocketBaseService.downloadFileToPath).not.toHaveBeenCalled();
    expect(executor.execute).toHaveBeenCalledWith(
      input.workspaceRef,
      input.mediaId,
      input.fileRef,
      input.config,
      undefined
    );
  });

  it('falls back when the audio proxy File record is not available', async () => {
    pocketBaseService.getFile.mockResolvedValue({
      ...audioFile,
      fileStatus: FileStatus.FAILED,
    });

    await runProcess();

    expect(pocketBaseService.downloadFileToPath).not.toHaveBeenCalled();
    expect(executor.execute).toHaveBeenCalledWith(
      input.workspaceRef,
      input.mediaId,
      input.fileRef,
      input.config,
      undefined
    );
  });

  it('falls back when the proxy download fails', async () => {
    pocketBaseService.downloadFileToPath.mockRejectedValue(
      new Error('download failed')
    );

    await runProcess();

    expect(executor.execute).toHaveBeenCalledWith(
      input.workspaceRef,
      input.mediaId,
      input.fileRef,
      input.config,
      undefined
    );
  });

  it('falls back when the downloaded proxy is empty', async () => {
    pocketBaseService.downloadFileToPath.mockImplementation(
      async (_file: unknown, destPath: string) => {
        await fs.promises.writeFile(destPath, '');
        return destPath;
      }
    );

    await runProcess();

    expect(executor.execute).toHaveBeenCalledWith(
      input.workspaceRef,
      input.mediaId,
      input.fileRef,
      input.config,
      undefined
    );
  });
});
