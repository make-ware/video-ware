import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { FFmpegService } from '../ffmpeg.service';
import * as fs from 'fs';

// Hoisted mock for child_process (vi.mock is hoisted, so we need hoisted variables)
const { execMock, spawnMock } = vi.hoisted(() => {
  const execMock = vi.fn(() => ({
    stderr: { on: vi.fn() },
    on: vi.fn(),
  }));

  (execMock as any)[Symbol.for('nodejs.util.promisify.custom')] = vi.fn();

  const spawnMock = vi.fn(() => ({
    stderr: {
      on: vi.fn(),
    },
    on: vi.fn(),
  }));

  return { execMock, spawnMock };
});

vi.mock('child_process', () => {
  return {
    exec: execMock,
    spawn: spawnMock,
  };
});

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  createWriteStream: vi.fn(),
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock NestJS Logger to suppress console output during tests
vi.mock('@nestjs/common', async () => {
  const actual = await vi.importActual('@nestjs/common');
  const { MockLogger } = await import('@/__mocks__/logger');
  return {
    ...actual,
    Logger: MockLogger,
  };
});

describe('FFmpegService', () => {
  let service: FFmpegService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FFmpegService],
    }).compile();

    service = module.get<FFmpegService>(FFmpegService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('probe', () => {
    it('should probe video file and return metadata', async () => {
      const mockProbeResult = {
        format: {
          duration: 120.5,
          size: 1000000,
          bit_rate: 8000,
          format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
          format_long_name: 'QuickTime / MOV',
        },
        streams: [
          {
            index: 0,
            codec_name: 'h264',
            codec_type: 'video' as const,
            width: 1920,
            height: 1080,
            duration: 120.5,
            bit_rate: 7500,
          },
          {
            index: 1,
            codec_name: 'aac',
            codec_type: 'audio' as const,
            sample_rate: 48000,
            channels: 2,
            bit_rate: 500,
          },
        ],
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      (execMock as any)[
        Symbol.for('nodejs.util.promisify.custom')
      ].mockResolvedValueOnce({
        stdout: JSON.stringify(mockProbeResult),
        stderr: '',
      });

      const result = await service.probe('/path/to/video.mp4');

      expect(result).toEqual(mockProbeResult);
      expect(fs.existsSync).toHaveBeenCalledWith('/path/to/video.mp4');
    });

    it('should throw error if file does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(service.probe('/nonexistent/video.mp4')).rejects.toThrow(
        'File not found: /nonexistent/video.mp4'
      );
    });

    it('should throw error if ffprobe fails', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      (execMock as any)[
        Symbol.for('nodejs.util.promisify.custom')
      ].mockRejectedValueOnce(new Error('FFprobe failed'));

      await expect(service.probe('/path/to/video.mp4')).rejects.toThrow(
        'FFprobe failed: FFprobe failed'
      );
    });

    it('should throw error if probe result is invalid', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      (execMock as any)[
        Symbol.for('nodejs.util.promisify.custom')
      ].mockResolvedValueOnce({
        stdout: '{"invalid": "result"}',
        stderr: '',
      });

      await expect(service.probe('/path/to/video.mp4')).rejects.toThrow(
        'Invalid probe result: missing format or streams'
      );
    });
  });

  describe('generateThumbnail', () => {
    it('should generate thumbnail successfully', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      (execMock as any)[
        Symbol.for('nodejs.util.promisify.custom')
      ].mockResolvedValueOnce({
        stdout: '',
        stderr:
          'frame=    1 fps=0.0 q=2.0 Lsize=N/A time=00:00:00.04 bitrate=N/A speed=0.833x',
      });

      await service.generateThumbnail(
        '/input.mp4',
        '/output.jpg',
        10,
        320,
        240
      );

      expect(
        (execMock as any)[Symbol.for('nodejs.util.promisify.custom')]
      ).toHaveBeenCalledWith(
        expect.stringContaining(
          'ffmpeg -y -ss 10 -i "/input.mp4" -vframes 1 -vf scale=320:240 -q:v 2 -update 1 "/output.jpg"'
        )
      );
      expect(fs.promises.mkdir).toHaveBeenCalled();
    });

    it('should throw error if thumbnail generation fails', async () => {
      (execMock as any)[
        Symbol.for('nodejs.util.promisify.custom')
      ].mockRejectedValueOnce(new Error('FFmpeg failed'));

      await expect(
        service.generateThumbnail('/input.mp4', '/output.jpg')
      ).rejects.toThrow('Thumbnail generation failed: FFmpeg failed');
    });

    it('should throw error if output file is not created', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      (execMock as any)[
        Symbol.for('nodejs.util.promisify.custom')
      ].mockResolvedValueOnce({
        stdout: '',
        stderr: '',
      });

      await expect(
        service.generateThumbnail('/input.mp4', '/output.jpg')
      ).rejects.toThrow(
        'Thumbnail generation failed: Thumbnail file was not created'
      );
    });
  });

  describe('generateSprite', () => {
    it('should generate sprite sheet successfully', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const mockProcess = {
        stderr: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              // Simulate successful output
              setTimeout(
                () =>
                  callback(
                    Buffer.from(
                      'frame=  100 fps=0.0 q=2.0 Lsize=N/A time=00:01:40.00 bitrate=N/A speed=10x'
                    )
                  ),
                10
              );
            }
          }),
        },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 20);
          }
        }),
      };
      spawnMock.mockReturnValueOnce(mockProcess as any);

      await service.generateSprite(
        '/input.mp4',
        '/output.jpg',
        0.1,
        10,
        10,
        160,
        120
      );

      expect(spawnMock).toHaveBeenCalledWith(
        'ffmpeg',
        expect.arrayContaining([
          '-y',
          '-i',
          '/input.mp4',
          '-vf',
          'fps=0.1,scale=160:120,tile=10x10',
          '-frames:v',
          '1',
          '-q:v',
          '2',
          '/output.jpg',
        ])
      );
    });

    it('should throw error if sprite generation fails', async () => {
      const mockProcess = {
        stderr: {
          on: vi.fn(),
        },
        on: vi.fn((event, callback) => {
          if (event === 'error') {
            setTimeout(() => callback(new Error('FFmpeg failed')), 10);
          }
        }),
      };
      spawnMock.mockReturnValueOnce(mockProcess as any);

      await expect(
        service.generateSprite('/input.mp4', '/output.jpg')
      ).rejects.toThrow('Sprite generation failed: FFmpeg failed');
    });
  });

  describe('transcode', () => {
    it('should transcode video successfully', async () => {
      vi.mocked(fs.existsSync)
        .mockReturnValueOnce(true) // Input file exists
        .mockReturnValueOnce(true); // Output file created

      // Mock probe for duration
      const probeResult = {
        format: { duration: 120 },
        streams: [],
      };
      (execMock as any)[
        Symbol.for('nodejs.util.promisify.custom')
      ].mockResolvedValueOnce({
        stdout: JSON.stringify(probeResult),
        stderr: '',
      });

      const mockProcess = {
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'close') callback(0);
        }),
      };
      execMock.mockReturnValueOnce(mockProcess as any);

      const options = {
        width: 1280,
        height: 720,
        videoBitrate: '2000k',
        audioBitrate: '128k',
      };

      await service.transcode('/input.mp4', '/output.mp4', options);

      expect(
        (execMock as any)[Symbol.for('nodejs.util.promisify.custom')]
      ).toHaveBeenCalledTimes(1); // Probe
      expect(execMock).toHaveBeenCalledTimes(1); // Transcode (progress tracking)
    });

    it('should handle progress callback', async () => {
      const progressCallback = vi.fn();

      vi.mocked(fs.existsSync)
        .mockReturnValueOnce(true) // Input file exists
        .mockReturnValueOnce(true); // Output file created

      // Mock probe
      const probeResult = {
        format: { duration: 120 },
        streams: [],
      };
      (execMock as any)[
        Symbol.for('nodejs.util.promisify.custom')
      ].mockResolvedValueOnce({
        stdout: JSON.stringify(probeResult),
        stderr: '',
      });

      // Mock transcode with progress
      const mockProcess = {
        stderr: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              // Trigger the callback immediately with progress data
              // Use setTimeout to ensure it's called asynchronously
              setImmediate(() => {
                callback('time=00:01:00.00 bitrate=1000kbits/s');
              });
            }
          }),
        },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            // Delay close to allow progress callback to fire
            setTimeout(() => callback(0), 20);
          }
        }),
      };

      execMock.mockReturnValueOnce(mockProcess as any);

      await service.transcode(
        '/input.mp4',
        '/output.mp4',
        {},
        progressCallback
      );

      expect(progressCallback).toHaveBeenCalled();
    });

    it('should throw error if transcode fails', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      // Mock probe
      const probeResult = {
        format: { duration: 120 },
        streams: [],
      };
      (execMock as any)[
        Symbol.for('nodejs.util.promisify.custom')
      ].mockResolvedValueOnce({
        stdout: JSON.stringify(probeResult),
        stderr: '',
      });

      // Mock failed transcode (process emits error)
      const mockProcess = {
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'error') callback(new Error('Transcode failed'));
        }),
      };
      execMock.mockReturnValueOnce(mockProcess as any);

      await expect(
        service.transcode('/input.mp4', '/output.mp4')
      ).rejects.toThrow('Transcode failed: Transcode failed');
    });
  });

  describe('extractAudio', () => {
    it('should extract audio successfully', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      (execMock as any)[
        Symbol.for('nodejs.util.promisify.custom')
      ].mockResolvedValueOnce({
        stdout: '',
        stderr: 'size=    1024kB time=00:02:00.00 bitrate= 128.0kbits/s',
      });

      await service.extractAudio('/input.mp4', '/output.wav', 'wav');

      expect(
        (execMock as any)[Symbol.for('nodejs.util.promisify.custom')]
      ).toHaveBeenCalledWith(
        expect.stringContaining(
          'ffmpeg -y -i "/input.mp4" -vn -ac 1 -ar 16000 -f wav "/output.wav"'
        )
      );
    });
  });

  describe('checkAvailability', () => {
    it('should return true if FFmpeg is available', async () => {
      (execMock as any)[Symbol.for('nodejs.util.promisify.custom')]
        .mockResolvedValueOnce({ stdout: 'ffmpeg version 4.4.0', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'ffprobe version 4.4.0', stderr: '' });

      const result = await service.checkAvailability();

      expect(result).toBe(true);
    });

    it('should return false if FFmpeg is not available', async () => {
      // Reset the mock to ensure clean state
      (execMock as any)[Symbol.for('nodejs.util.promisify.custom')].mockReset();

      // Mock the first call to fail (ffmpeg -version)
      (execMock as any)[
        Symbol.for('nodejs.util.promisify.custom')
      ].mockRejectedValueOnce(new Error('Command not found'));

      const result = await service.checkAvailability();

      expect(result).toBe(false);
      // Verify the mock was called (only once since it fails on first call)
      expect(
        (execMock as any)[Symbol.for('nodejs.util.promisify.custom')]
      ).toHaveBeenCalledTimes(1);
    });
  });
});
