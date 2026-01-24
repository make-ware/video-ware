import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PocketBaseService } from '../pocketbase.service';
import { createMockConfigService } from '@/__mocks__/config.service';

// Mock Logger
vi.mock('@nestjs/common', async () => {
  const actual = await vi.importActual('@nestjs/common');
  const { MockLogger } = await import('@/__mocks__/logger');
  return {
    ...actual,
    Logger: MockLogger,
  };
});

describe('PocketBaseService', () => {
  let service: PocketBaseService;
  let configService: ReturnType<typeof createMockConfigService>;
  let mockPbClient: any;
  let mockPbClientService: any;
  let mockGetList: any;

  beforeEach(async () => {
    configService = createMockConfigService({
      'pocketbase.url': 'http://localhost:8090',
      'pocketbase.adminEmail': 'admin@example.com',
      'pocketbase.adminPassword': 'password',
    });

    mockGetList = vi.fn();

    // Mock PB Client
    mockPbClient = {
      autoCancellation: vi.fn(),
      collection: vi.fn((name) => {
        if (name === '_superusers') {
          return {
            authWithPassword: vi.fn().mockResolvedValue({ token: 'token' }),
          };
        }
        if (name === 'TimelineClips') {
          return {
            getList: mockGetList,
          };
        }
        return {
          getList: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
          getOne: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
          getFirstListItem: vi.fn(),
        };
      }),
      health: {
        check: vi.fn().mockResolvedValue({ code: 200 }),
      },
    };

    mockPbClientService = {
      createClient: vi.fn().mockResolvedValue(mockPbClient),
    };

    service = new PocketBaseService(configService, mockPbClientService);

    // Initialize
    await service.onModuleInit();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getTimelineClips', () => {
    it('should return all clips (array) by fetching all pages', async () => {
      // Page 1
      mockGetList.mockResolvedValueOnce({
        page: 1,
        perPage: 500,
        totalItems: 600,
        totalPages: 2,
        items: Array.from({ length: 500 }, (_, i) => ({ id: `clip-${i}` })),
      });
      // Page 2
      mockGetList.mockResolvedValueOnce({
        page: 2,
        perPage: 500,
        totalItems: 600,
        totalPages: 2,
        items: Array.from({ length: 100 }, (_, i) => ({
          id: `clip-${i + 500}`,
        })),
      });

      const timelineId = 'timeline-123';
      const result = await service.getTimelineClips(timelineId);

      // Should return array of 600 items
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(600);

      // Should have called getList twice (via getAllTimelineClips -> getPaginatedTimelineClips)
      expect(mockGetList).toHaveBeenCalledTimes(2);
    });
  });

  describe('getPaginatedTimelineClips', () => {
    it('should fetch with default pagination', async () => {
      mockGetList.mockResolvedValueOnce({
        page: 1,
        perPage: 100,
        totalItems: 50,
        totalPages: 1,
        items: [{ id: 'clip-1' }],
      });

      const timelineId = 'timeline-123';
      const result = await service.getPaginatedTimelineClips(timelineId);

      expect(mockGetList).toHaveBeenCalledWith(1, 100, {
        expand:
          'TimelineRef,MediaRef,MediaRef.UploadRef,MediaRef.thumbnailFileRef,MediaRef.spriteFileRef,MediaRef.filmstripFileRefs,MediaClipRef',
        filter: `TimelineRef = "${timelineId}"`,
        sort: 'order',
      });

      // Expect full result object
      expect(result).toEqual({
        page: 1,
        perPage: 100,
        totalItems: 50,
        totalPages: 1,
        items: [{ id: 'clip-1' }],
      });
    });

    it('should fetch with custom pagination', async () => {
      mockGetList.mockResolvedValueOnce({
        page: 2,
        perPage: 50,
        totalItems: 100,
        totalPages: 2,
        items: [{ id: 'clip-2' }],
      });

      const timelineId = 'timeline-123';
      const result = await service.getPaginatedTimelineClips(timelineId, 2, 50);

      expect(mockGetList).toHaveBeenCalledWith(2, 50, {
        expand:
          'TimelineRef,MediaRef,MediaRef.UploadRef,MediaRef.thumbnailFileRef,MediaRef.spriteFileRef,MediaRef.filmstripFileRefs,MediaClipRef',
        filter: `TimelineRef = "${timelineId}"`,
        sort: 'order',
      });

      expect(result.page).toBe(2);
      expect(result.perPage).toBe(50);
    });
  });

  describe('getAllTimelineClips', () => {
    it('should fetch all pages and combine items', async () => {
      // Page 1
      mockGetList.mockResolvedValueOnce({
        page: 1,
        perPage: 500,
        totalItems: 600,
        totalPages: 2,
        items: Array.from({ length: 500 }, (_, i) => ({
          id: `clip-${i}`,
          order: i,
        })),
      });

      // Page 2
      mockGetList.mockResolvedValueOnce({
        page: 2,
        perPage: 500,
        totalItems: 600,
        totalPages: 2,
        items: Array.from({ length: 100 }, (_, i) => ({
          id: `clip-${i + 500}`,
          order: i + 500,
        })),
      });

      const timelineId = 'timeline-abc';
      const result = await service.getAllTimelineClips(timelineId);

      // Should have called twice
      expect(mockGetList).toHaveBeenCalledTimes(2);
      expect(mockGetList).toHaveBeenNthCalledWith(
        1,
        1,
        500,
        expect.any(Object)
      );
      expect(mockGetList).toHaveBeenNthCalledWith(
        2,
        2,
        500,
        expect.any(Object)
      );

      // Result should be flat array of 600 items
      expect(result).toHaveLength(600);
      expect(result[0].id).toBe('clip-0');
      expect(result[599].id).toBe('clip-599');
    });
  });
});
