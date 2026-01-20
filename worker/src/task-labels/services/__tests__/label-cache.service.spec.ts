import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LabelCacheService } from '../label-cache.service';
import { ProcessingProvider, RawLabelCacheFile } from '@project/shared';

// Mock NestJS Logger to suppress console output during tests
vi.mock('@nestjs/common', async () => {
  const actual = await vi.importActual('@nestjs/common');
  const { MockLogger } = await import('@/__mocks__/logger');
  return {
    ...actual,
    Logger: MockLogger,
  };
});

describe('LabelCacheService', () => {
  let service: LabelCacheService;
  let mockStorageService: any;

  beforeEach(() => {
    mockStorageService = {
      exists: vi.fn(),
      download: vi.fn(),
      upload: vi.fn(),
    };

    service = new LabelCacheService(mockStorageService);
  });

  describe('getCachedLabels', () => {
    it('should return null if cache does not exist', async () => {
      mockStorageService.exists.mockResolvedValue(false);

      const result = await service.getCachedLabels(
        'workspace123',
        'media123',
        1,
        ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        'label-detection:1.0.0'
      );

      expect(result).toBeNull();
      expect(mockStorageService.exists).toHaveBeenCalledWith(
        'labels/workspace123/media123/v1/label-detection_google_video_intelligence.json'
      );
    });

    it('should return cached data if exists', async () => {
      const cacheData: RawLabelCacheFile = {
        metadata: {
          mediaId: 'media123',
          version: 1,
          provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          processor: 'video-intelligence:1.0.0',
          createdAt: '2024-01-01T00:00:00.000Z',
          features: ['LABEL_DETECTION'],
        },
        response: { labels: ['test'] },
      };

      const jsonString = JSON.stringify(cacheData);
      const buffer = new TextEncoder().encode(jsonString);

      // Mock ReadableStream
      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({ done: false, value: buffer })
          .mockResolvedValueOnce({ done: true }),
        releaseLock: vi.fn(),
      };
      const mockStream = {
        getReader: vi.fn().mockReturnValue(mockReader),
      };

      mockStorageService.exists.mockResolvedValue(true);
      mockStorageService.download.mockResolvedValue(mockStream);

      const result = await service.getCachedLabels(
        'workspace123',
        'media123',
        1,
        ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        'label-detection:1.0.0'
      );

      expect(result).toEqual(cacheData);
      expect(mockStorageService.download).toHaveBeenCalledWith(
        'labels/workspace123/media123/v1/label-detection_google_video_intelligence.json'
      );
    });

    it('should return null if download fails', async () => {
      mockStorageService.exists.mockResolvedValue(true);
      mockStorageService.download.mockRejectedValue(
        new Error('Download failed')
      );

      const result = await service.getCachedLabels(
        'workspace123',
        'media123',
        1,
        ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        'label-detection:1.0.0'
      );

      expect(result).toBeNull();
    });

    it('should handle multiple chunks in stream', async () => {
      const cacheData: RawLabelCacheFile = {
        metadata: {
          mediaId: 'media123',
          version: 1,
          provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          processor: 'video-intelligence:1.0.0',
          createdAt: '2024-01-01T00:00:00.000Z',
          features: [],
        },
        response: { data: 'test' },
      };

      const jsonString = JSON.stringify(cacheData);
      const fullBuffer = new TextEncoder().encode(jsonString);
      const chunk1 = fullBuffer.slice(0, 50);
      const chunk2 = fullBuffer.slice(50);

      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({ done: false, value: chunk1 })
          .mockResolvedValueOnce({ done: false, value: chunk2 })
          .mockResolvedValueOnce({ done: true }),
        releaseLock: vi.fn(),
      };
      const mockStream = {
        getReader: vi.fn().mockReturnValue(mockReader),
      };

      mockStorageService.exists.mockResolvedValue(true);
      mockStorageService.download.mockResolvedValue(mockStream);

      const result = await service.getCachedLabels(
        'workspace123',
        'media123',
        1,
        ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        'label-detection:1.0.0'
      );

      expect(result).toEqual(cacheData);
    });
  });

  describe('storeLabelCache', () => {
    it('should store cache data to storage', async () => {
      const data = { labels: ['test'] };
      const processor = 'video-intelligence:1.0.0';
      const features = ['LABEL_DETECTION'];

      await service.storeLabelCache(
        'workspace123',
        'media123',
        1,
        ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        data,
        processor,
        features
      );

      expect(mockStorageService.upload).toHaveBeenCalledWith(
        'labels/workspace123/media123/v1/video-intelligence_google_video_intelligence.json',
        expect.any(Buffer)
      );

      // Verify the uploaded data structure
      const uploadCall = mockStorageService.upload.mock.calls[0];
      const uploadedBuffer = uploadCall[1] as Buffer;
      const uploadedData = JSON.parse(uploadedBuffer.toString('utf-8'));

      expect(uploadedData.metadata.mediaId).toBe('media123');
      expect(uploadedData.metadata.version).toBe(1);
      expect(uploadedData.metadata.provider).toBe(
        ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE
      );
      expect(uploadedData.metadata.processor).toBe(processor);
      expect(uploadedData.metadata.features).toEqual(features);
      expect(uploadedData.response).toEqual(data);
    });

    it('should store cache with empty features array by default', async () => {
      const data = { labels: ['test'] };
      const processor = 'video-intelligence:1.0.0';

      await service.storeLabelCache(
        'workspace123',
        'media123',
        1,
        ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        data,
        processor
      );

      const uploadCall = mockStorageService.upload.mock.calls[0];
      const uploadedBuffer = uploadCall[1] as Buffer;
      const uploadedData = JSON.parse(uploadedBuffer.toString('utf-8'));

      expect(uploadedData.metadata.features).toEqual([]);
    });

    it('should throw error if upload fails', async () => {
      mockStorageService.upload.mockRejectedValue(new Error('Upload failed'));

      await expect(
        service.storeLabelCache(
          'workspace123',
          'media123',
          1,
          ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          { data: 'test' },
          'video-intelligence:1.0.0'
        )
      ).rejects.toThrow('Upload failed');
    });
  });

  describe('isCacheValid', () => {
    it('should return true if processor versions match', () => {
      const cached: RawLabelCacheFile = {
        metadata: {
          mediaId: 'media123',
          version: 1,
          provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          processor: 'video-intelligence:1.0.0',
          createdAt: '2024-01-01T00:00:00.000Z',
          features: [],
        },
        response: {},
      };

      const result = service.isCacheValid(cached, 'video-intelligence:1.0.0');

      expect(result).toBe(true);
    });

    it('should return false if processor versions differ', () => {
      const cached: RawLabelCacheFile = {
        metadata: {
          mediaId: 'media123',
          version: 1,
          provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          processor: 'video-intelligence:1.0.0',
          createdAt: '2024-01-01T00:00:00.000Z',
          features: [],
        },
        response: {},
      };

      const result = service.isCacheValid(cached, 'video-intelligence:2.0.0');

      expect(result).toBe(false);
    });

    it('should return false for different processor names', () => {
      const cached: RawLabelCacheFile = {
        metadata: {
          mediaId: 'media123',
          version: 1,
          provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          processor: 'video-intelligence:1.0.0',
          createdAt: '2024-01-01T00:00:00.000Z',
          features: [],
        },
        response: {},
      };

      const result = service.isCacheValid(cached, 'label-normalizer:1.0.0');

      expect(result).toBe(false);
    });
  });
});
