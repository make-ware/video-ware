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
    // Keep the in-process readiness wait short in tests. The window is large
    // enough for the "waits then proceeds" case (a few polls) yet small enough
    // that the timeout-fallback cases resolve quickly.
    process.env.SPEAKER_TRANSCRIPTION_AUDIO_WAIT_MS = '200';
    process.env.SPEAKER_TRANSCRIPTION_AUDIO_POLL_MS = '10';

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
        duration: 10,
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
      withTempLease: vi
        .fn()
        .mockImplementation((_recordId: string, fn: () => Promise<unknown>) =>
          fn()
        ),
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
    delete process.env.SPEAKER_TRANSCRIPTION_AUDIO_WAIT_MS;
    delete process.env.SPEAKER_TRANSCRIPTION_AUDIO_POLL_MS;
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
      duration: 10,
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

  it('skips (no ElevenLabs call) once probe reports no audio', async () => {
    pocketBaseService.getMedia.mockResolvedValue({
      id: 'media-1',
      duration: 10,
      hasAudio: false,
    });

    const result = await runProcess();

    expect(executor.execute).not.toHaveBeenCalled();
    expect(pocketBaseService.getFile).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.counts.labelSpeakerCount).toBe(0);
  });

  it('waits for the transcode audio proxy, then uses it', async () => {
    // First reads: probe not done yet (placeholder duration 0). Later reads:
    // probe + audio step have landed, so the proxy is available.
    pocketBaseService.getMedia
      .mockResolvedValueOnce({ id: 'media-1', duration: 0, hasAudio: true })
      .mockResolvedValueOnce({ id: 'media-1', duration: 0, hasAudio: true })
      .mockResolvedValue({
        id: 'media-1',
        duration: 10,
        hasAudio: true,
        audioFileRef: audioFile.id,
      });

    await runProcess();

    const expectedPath = path.join(
      tempDir,
      `${audioFile.id}-${audioFile.name}`
    );
    expect(pocketBaseService.getMedia.mock.calls.length).toBeGreaterThan(1);
    expect(executor.execute).toHaveBeenCalledWith(
      input.workspaceRef,
      input.mediaId,
      input.fileRef,
      input.config,
      expectedPath
    );
  });

  it('falls back to the original when the proxy never becomes ready in time', async () => {
    // Probe done, has audio, but the audio proxy stays unavailable for the
    // whole (tiny, in test) window -> proceed against the original upload.
    pocketBaseService.getMedia.mockResolvedValue({
      id: 'media-1',
      duration: 10,
      hasAudio: true,
      audioFileRef: audioFile.id,
    });
    pocketBaseService.getFile.mockResolvedValue({
      ...audioFile,
      fileStatus: FileStatus.PENDING,
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
