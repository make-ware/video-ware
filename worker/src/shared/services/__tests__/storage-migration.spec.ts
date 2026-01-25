import { ConfigService } from '@nestjs/config';
import { StorageService } from '../storage.service';
import * as fs from 'fs';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock NestJS Logger to suppress console output during tests
vi.mock('@nestjs/common', async () => {
  const actual = await vi.importActual('@nestjs/common');
  const { MockLogger } = await import('@/__mocks__/logger');
  return {
    ...actual,
    Logger: MockLogger,
  };
});

// Mock shared storage imports
vi.mock('@project/shared/storage', () => {
  return {
    createStorageBackend: vi.fn(),
    LocalStorageBackend: class {
      constructor() {}
      initialize = vi.fn().mockResolvedValue(undefined);
      listFiles = vi
        .fn()
        .mockResolvedValue([
          { key: 'test-file.txt' },
          { key: 'already-exists.txt' },
        ]);
      download = vi.fn().mockResolvedValue('mock-stream');
    },
    StorageBackendType: {
      LOCAL: 'local',
      S3: 's3',
    },
  };
});

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

describe('StorageService Migration', () => {
  let service: StorageService;
  let configService: ConfigService;
  let mockBackend: any;
  let createStorageBackendMock: any;

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();

    mockBackend = {
      type: 's3',
      exists: vi.fn().mockImplementation((key) => {
        return Promise.resolve(key === 'already-exists.txt');
      }),
      upload: vi.fn().mockResolvedValue(undefined),
    };

    const storageModule = await import('@project/shared/storage');
    createStorageBackendMock = storageModule.createStorageBackend;
    createStorageBackendMock.mockResolvedValue(mockBackend);

    // Mock ConfigService
    const mockConfigService = {
      get: vi.fn((key, defaultValue) => {
        if (key === 'storage.type') return 's3';
        if (key === 'storage.s3Bucket') return 'test-bucket';
        if (key === 'storage.s3Region') return 'us-east-1';
        if (key === 'storage.s3AccessKeyId') return 'key';
        if (key === 'storage.s3SecretAccessKey') return 'secret';
        if (key === 'storage.localPath') return './data';
        return defaultValue;
      }),
    };

    configService = mockConfigService as any;
    // Manual instantiation to avoid DI issues
    service = new StorageService(configService);

    // Mock fs.existsSync
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should migrate files from local to S3 on initialization', async () => {
    await service.onModuleInit();

    // Verify backend creation
    expect(createStorageBackendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 's3',
        s3: expect.anything(),
      })
    );

    // Verify migration logic
    // specific file 'test-file.txt' should be uploaded because exisis is false
    expect(mockBackend.upload).toHaveBeenCalledWith(
      'mock-stream',
      'test-file.txt'
    );

    // 'already-exists.txt' should NOT be uploaded because exists is true
    expect(mockBackend.upload).not.toHaveBeenCalledWith(
      'mock-stream',
      'already-exists.txt'
    );

    // Should have checked existence for both
    expect(mockBackend.exists).toHaveBeenCalledWith('test-file.txt');
    expect(mockBackend.exists).toHaveBeenCalledWith('already-exists.txt');
  });
});
