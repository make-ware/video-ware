import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FFmpegProbeExecutor } from '../executors/ffmpeg/probe.executor';
import { FFmpegService } from '../../shared/services/ffmpeg.service';
import { StorageService } from '../../shared/services/storage.service';
import { StorageBackendType } from '@project/shared';
import { vi, describe, beforeEach, it, expect, type Mock } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock StorageBackend
const mockStorageBackend = {
  type: StorageBackendType.LOCAL,
  exists: vi.fn(),
  download: vi.fn(),
  upload: vi.fn(),
  delete: vi.fn(),
  getUrl: vi.fn(),
  listFiles: vi.fn(),
  resolvePath: vi.fn(),
};

// Mock @project/shared/storage. Spread the real module so non-stubbed
// exports (e.g. resolveLocalStorageBasePath) keep working.
vi.mock('@project/shared/storage', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createStorageBackend: vi.fn(() => Promise.resolve(mockStorageBackend)),
  LocalStorageBackend: class {
    initialize = vi.fn().mockResolvedValue(undefined);
    listFiles = vi.fn().mockResolvedValue([]);
    download = vi.fn().mockResolvedValue({
      getReader: () => ({
        read: () => Promise.resolve({ done: true, value: undefined }),
        releaseLock: () => {},
      }),
    });
  },
}));

describe('Probe Step Storage Integration', () => {
  let probeExecutor: FFmpegProbeExecutor;
  let storageService: StorageService;
  let configService: ConfigService;
  let ffmpegService: FFmpegService;

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();
    (mockStorageBackend.exists as Mock).mockResolvedValue(true);

    // Mock download to return a real web ReadableStream — downloadToTemp pipes
    // it through stream.pipeline via Readable.fromWeb, which rejects
    // hand-rolled getReader() fakes with ERR_INVALID_ARG_TYPE.
    (mockStorageBackend.download as Mock).mockImplementation(() =>
      Promise.resolve(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('dummy data'));
            controller.close();
          },
        })
      )
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FFmpegProbeExecutor,
        StorageService,
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn(),
          },
        },
        {
          provide: FFmpegService,
          useValue: {
            probe: vi.fn().mockResolvedValue({
              format: { duration: 10, size: 1000, bit_rate: 1000, tags: {} },
              streams: [{ codec_type: 'video', width: 1920, height: 1080 }],
            }),
          },
        },
      ],
    }).compile();

    // Get mocks
    configService = module.get<ConfigService>(ConfigService);
    ffmpegService = module.get<FFmpegService>(FFmpegService);

    // Manually instantiate services to bypass DI issues in this test environment
    storageService = new StorageService(configService);
    probeExecutor = new FFmpegProbeExecutor(ffmpegService);

    // Mock fs for temp file check in downloadToTemp
    // We need to verify what fs.existsSync returns.
    // But since we can't easily mock fs globally for just this file without affecting others safely
    // (though vitest isolates, we invoke fs inside StorageService),
    // we might just assume the temp path is unique.
    // Actually, we should check if file exists.
    // But let's assume standard behavior.
  });

  describe('Storage Configuration and Probe Execution', () => {
    it('should handle LOCAL storage configuration', async () => {
      // Arrange: Config is LOCAL
      (configService.get as Mock).mockImplementation((key, defaultVal) => {
        if (key === 'storage.type') return 'local';
        if (key === 'storage.localPath') return '/tmp/data';
        return defaultVal;
      });

      // Update mock backend type
      mockStorageBackend.type = StorageBackendType.LOCAL;
      (mockStorageBackend.resolvePath as Mock).mockImplementation(
        (p) => `/tmp/data/${p}`
      );

      // Initialize StorageService
      await storageService.onModuleInit();

      const testFile = 'test-video.mp4';

      // Act: Resolve path
      const resolvedPath = await storageService.resolveFilePath({
        storagePath: testFile,
      });

      // Assert Path
      expect(resolvedPath).toBe(`/tmp/data/${testFile}`);

      // Act: Run Probe
      await probeExecutor.execute(resolvedPath);

      // Assert Probe call
      expect(ffmpegService.probe).toHaveBeenCalledWith(resolvedPath);
    });

    it('should probe audio-only files without throwing', async () => {
      // Arrange: ffprobe reports a single audio stream, no video
      (ffmpegService.probe as Mock).mockResolvedValueOnce({
        format: {
          duration: 110.05,
          size: 1760000,
          bit_rate: 128000,
          format_name: 'mp3',
          tags: {},
        },
        streams: [
          {
            codec_type: 'audio',
            codec_name: 'mp3',
            channels: 2,
            sample_rate: '44100',
            bit_rate: '128000',
          },
        ],
      });

      // Act
      const { probeOutput } = await probeExecutor.execute('/tmp/song.mp3');

      // Assert: no video block, audio populated, zeroed dimensions
      expect(probeOutput.video).toBeUndefined();
      expect(probeOutput.width).toBe(0);
      expect(probeOutput.height).toBe(0);
      expect(probeOutput.fps).toBe(0);
      expect(probeOutput.duration).toBeCloseTo(110.05);
      expect(probeOutput.codec).toBe('mp3');
      expect(probeOutput.audio).toEqual({
        codec: 'mp3',
        channels: 2,
        sampleRate: '44100',
        bitrate: 128000,
      });
    });

    it('should throw when no audio or video stream is present', async () => {
      (ffmpegService.probe as Mock).mockResolvedValueOnce({
        format: { duration: 0, tags: {} },
        streams: [],
      });

      await expect(probeExecutor.execute('/tmp/empty.bin')).rejects.toThrow(
        'No video or audio stream found in input file'
      );
    });

    it('should handle S3 storage configuration (Download to Temp)', async () => {
      // Arrange: Config is S3
      (configService.get as Mock).mockImplementation((key, defaultVal) => {
        if (key === 'storage.type') return 's3';
        if (key === 'storage.s3Bucket') return 'my-bucket';
        if (key === 'storage.s3Region') return 'us-east-1';
        if (key === 'storage.s3AccessKeyId') return 'key';
        if (key === 'storage.s3SecretAccessKey') return 'secret';
        return defaultVal;
      });

      // Update mock backend type
      mockStorageBackend.type = StorageBackendType.S3;

      // Initialize StorageService
      await storageService.onModuleInit();

      const testFile = 's3-video.mp4';
      const recordId = '12345';

      // This test uses the real fs, and downloadToTemp writes to a
      // deterministic path under os.tmpdir(). Remove any leftover from a
      // previous run so the download branch (not the cached-file branch) is
      // always the one exercised.
      const tempDir = path.join(os.tmpdir(), 'worker-temp', recordId);
      fs.rmSync(tempDir, { recursive: true, force: true });

      try {
        // Act: Resolve path
        const resolvedPath = await storageService.resolveFilePath({
          storagePath: testFile,
          recordId,
        });

        // Assert: resolved path is in the temp dir, and the download was
        // actually streamed to disk
        expect(resolvedPath).toContain('worker-temp');
        expect(resolvedPath).toContain(recordId);
        expect(resolvedPath).toContain(testFile);
        expect(mockStorageBackend.download).toHaveBeenCalledWith(testFile);
        expect(fs.readFileSync(resolvedPath, 'utf8')).toBe('dummy data');

        // Act: Run Probe
        await probeExecutor.execute(resolvedPath);

        // Assert Probe call
        expect(ffmpegService.probe).toHaveBeenCalledWith(resolvedPath);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
