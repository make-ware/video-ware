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

vi.mock('@project/shared/storage', () => ({
  createStorageBackend: vi.fn(),
  LocalStorageBackend: class {},
  StorageBackendType: { LOCAL: 'local', S3: 's3' },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    promises: { ...actual.promises, rm: vi.fn().mockResolvedValue(undefined) },
  };
});

function buildService(storageType: 'local' | 's3'): StorageService {
  const mockConfigService = {
    get: vi.fn((key: string, defaultValue?: unknown) => {
      if (key === 'storage.type') return storageType;
      if (key === 'storage.localPath') return '/data/storage';
      if (key === 'storage.s3Bucket') return 'bucket';
      if (key === 'storage.s3Region') return 'us-east-1';
      if (key === 'storage.s3AccessKeyId') return 'key';
      if (key === 'storage.s3SecretAccessKey') return 'secret';
      return defaultValue;
    }),
  };
  return new StorageService(mockConfigService as unknown as ConfigService);
}

describe('StorageService.cleanupRenderDir', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const storageModule = await import('@project/shared/storage');
    (storageModule.createStorageBackend as any).mockImplementation(
      (config: { type: string }) =>
        Promise.resolve({ type: config.type, exists: vi.fn() })
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it('removes the render directory when using S3', async () => {
    const service = buildService('s3');
    await service.onModuleInit();

    vi.mocked(fs.existsSync).mockReturnValue(true);

    await service.cleanupRenderDir('ws1', 'task1');

    expect(fs.promises.rm).toHaveBeenCalledWith(
      expect.stringContaining('renders/ws1/task1'),
      { recursive: true, force: true }
    );
  });

  it('is a no-op in local mode (durable storage is preserved)', async () => {
    const service = buildService('local');
    await service.onModuleInit();

    await service.cleanupRenderDir('ws1', 'task1');

    expect(fs.promises.rm).not.toHaveBeenCalled();
  });
});
