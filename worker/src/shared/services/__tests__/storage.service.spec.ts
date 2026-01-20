import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StorageService } from '../storage.service';
import { StorageBackendType } from '@project/shared';
import * as fs from 'fs';
import * as path from 'path';
import { createMockConfigService } from '@/__mocks__/config.service';

// Hoisted mock storage backend (vi.mock is hoisted, so we need hoisted variables)
const { mockStorageBackend } = vi.hoisted(() => {
  const mockStorageBackend = {
    type: 'local' as StorageBackendType,
    initialize: vi.fn().mockResolvedValue(undefined),
    upload: vi.fn().mockResolvedValue({ path: 'test.mp4', size: 1000 }),
    download: vi.fn().mockResolvedValue(new ReadableStream()),
    exists: vi.fn().mockResolvedValue(true),
    delete: vi.fn().mockResolvedValue(undefined),
    getUrl: vi.fn().mockResolvedValue('http://localhost/test.mp4'),
    listFiles: vi.fn().mockResolvedValue([]),
    resolvePath: vi.fn().mockReturnValue('/local/path/test.mp4'),
  };
  return { mockStorageBackend };
});

vi.mock('@project/shared/storage', () => {
  return {
    createStorageBackend: vi.fn().mockImplementation(async () => {
      // Call initialize when backend is created (mimicking real behavior)
      await mockStorageBackend.initialize();
      return mockStorageBackend;
    }),
    StorageBackendType: {
      LOCAL: 'local',
      S3: 's3',
    },
  };
});

// Get the mock instance for use in tests
const getMockStorageBackend = () => {
  if (!mockStorageBackend) {
    throw new Error('Mock storage backend not initialized');
  }
  return mockStorageBackend;
};

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  createWriteStream: vi.fn(),
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from('test data')),
    rm: vi.fn().mockResolvedValue(undefined),
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

describe('StorageService', () => {
  let service: StorageService;
  let configService: ReturnType<typeof createMockConfigService>;

  beforeEach(() => {
    configService = createMockConfigService({
      'storage.type': 'local',
      'storage.localPath': './data',
      'storage.s3Bucket': 'test-bucket',
      'storage.s3Region': 'us-east-1',
      'storage.s3AccessKeyId': 'test-key',
      'storage.s3SecretAccessKey': 'test-secret',
    });
    service = new StorageService(configService);

    // Reset mock storage backend to default state
    mockStorageBackend.initialize.mockResolvedValue(undefined);
    mockStorageBackend.upload.mockResolvedValue({
      path: 'test.mp4',
      size: 1000,
    });
    mockStorageBackend.download.mockResolvedValue(new ReadableStream());
    mockStorageBackend.exists.mockResolvedValue(true);
    mockStorageBackend.delete.mockResolvedValue(undefined);
    mockStorageBackend.getUrl.mockResolvedValue('http://localhost/test.mp4');
    mockStorageBackend.listFiles.mockResolvedValue([]);
    mockStorageBackend.resolvePath.mockReturnValue('/local/path/test.mp4');
    mockStorageBackend.type = 'local' as StorageBackendType;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('should initialize local storage backend', async () => {
      await service.onModuleInit();

      expect(getMockStorageBackend().initialize).toHaveBeenCalled();
    });

    it('should initialize S3 storage backend', async () => {
      const s3ConfigService = createMockConfigService({
        'storage.type': 's3',
        'storage.s3Bucket': 'test-bucket',
        'storage.s3Region': 'us-east-1',
        'storage.s3AccessKeyId': 'test-key',
        'storage.s3SecretAccessKey': 'test-secret',
      });
      const s3Service = new StorageService(s3ConfigService);

      await s3Service.onModuleInit();

      expect(getMockStorageBackend().initialize).toHaveBeenCalled();
    });

    it('should throw error if S3 configuration is incomplete', async () => {
      const incompleteConfigService = createMockConfigService({
        'storage.type': 's3',
        'storage.s3Bucket': 'test-bucket',
        // Missing other S3 config
      });
      const incompleteService = new StorageService(incompleteConfigService);

      await expect(incompleteService.onModuleInit()).rejects.toThrow(
        'S3 storage configuration is incomplete'
      );
    });
  });

  describe('resolveFilePath', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should return local path for local storage', async () => {
      const params = {
        storagePath: 'uploads/workspace1/upload1/original.mp4',
        storageBackend: StorageBackendType.LOCAL,
      };

      const result = await service.resolveFilePath(params);

      expect(result).toBe('/local/path/test.mp4');
      expect(getMockStorageBackend().resolvePath).toHaveBeenCalledWith(
        params.storagePath
      );
    });

    it('should download to temp for S3 storage', async () => {
      const params = {
        storagePath: 'uploads/workspace1/upload1/original.mp4',
        storageBackend: StorageBackendType.S3,
        recordId: 'upload1',
      };

      // Mock backend type as S3
      getMockStorageBackend().type = StorageBackendType.S3;

      // Mock fs operations
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const mockWriteStream = {
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn((event, callback) => {
          if (event === 'finish') {
            setTimeout(callback, 0);
          }
        }),
      };
      vi.mocked(fs.createWriteStream).mockReturnValue(mockWriteStream as any);

      // Mock ReadableStream
      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new Uint8Array([1, 2, 3]),
          })
          .mockResolvedValueOnce({ done: true }),
        releaseLock: vi.fn(),
      };
      const mockStream = {
        getReader: vi.fn().mockReturnValue(mockReader),
      };
      getMockStorageBackend().download.mockResolvedValue(mockStream);

      const result = await service.resolveFilePath(params);

      expect(result).toContain('upload1');
      expect(getMockStorageBackend().exists).toHaveBeenCalledWith(
        params.storagePath
      );
      expect(getMockStorageBackend().download).toHaveBeenCalledWith(
        params.storagePath
      );
    });

    it('should throw error if storage path is missing', async () => {
      const params = {} as any;

      await expect(service.resolveFilePath(params)).rejects.toThrow(
        'Storage path is required'
      );
    });

    it('should throw error for unsupported storage type', async () => {
      // Set backend type to something other than LOCAL or S3 to test unsupported type
      mockStorageBackend.type = 'unsupported' as any;
      const params = {
        storagePath: 'test.mp4',
        storageBackend: 'unsupported' as any,
      };

      await expect(service.resolveFilePath(params)).rejects.toThrow(
        'Unsupported storage type: unsupported'
      );
    });
  });

  describe('upload', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should upload data to storage', async () => {
      const data = Buffer.from('test data');
      const filePath = 'test/file.mp4';

      await service.upload(filePath, data);

      expect(getMockStorageBackend().upload).toHaveBeenCalledWith(
        data,
        filePath
      );
    });

    it('should throw error if upload fails', async () => {
      getMockStorageBackend().upload.mockRejectedValue(
        new Error('Upload failed')
      );

      await expect(
        service.upload('test.mp4', Buffer.from('data'))
      ).rejects.toThrow('Upload failed');
    });
  });

  describe('uploadFromPath', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should read file and upload to storage', async () => {
      const localPath = '/local/test.mp4';
      const storagePath = 'uploads/test.mp4';
      const fileData = Buffer.from('test data');

      vi.mocked(fs.promises.readFile).mockResolvedValue(fileData);

      await service.uploadFromPath(localPath, storagePath);

      expect(fs.promises.readFile).toHaveBeenCalledWith(localPath);
      expect(getMockStorageBackend().upload).toHaveBeenCalledWith(
        fileData,
        storagePath
      );
    });
  });

  describe('exists', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should check if file exists', async () => {
      getMockStorageBackend().exists.mockResolvedValue(true);

      const result = await service.exists('test.mp4');

      expect(result).toBe(true);
      expect(getMockStorageBackend().exists).toHaveBeenCalledWith('test.mp4');
    });

    it('should return false if check fails', async () => {
      getMockStorageBackend().exists.mockRejectedValue(
        new Error('Check failed')
      );

      const result = await service.exists('test.mp4');

      expect(result).toBe(false);
    });
  });

  describe('generateDerivedPath', () => {
    it('should generate derived file path', () => {
      const params = {
        baseStoragePath: 'uploads/workspace1/upload1/original.mp4',
        suffix: 'thumbnail',
        extension: 'jpg',
      };

      const result = service.generateDerivedPath(params);

      expect(result).toBe('uploads/workspace1/upload1/thumbnail.jpg');
    });

    it('should handle upload without externalPath', () => {
      const params = {
        workspaceId: 'workspace1',
        recordId: 'upload1',
        suffix: 'sprite',
        extension: 'jpg',
      };

      const result = service.generateDerivedPath(params);

      expect(result).toBe('uploads/workspace1/upload1/sprite.jpg');
    });
  });

  describe('render paths', () => {
    const workspaceId = 'workspace123';
    const taskId = 'task456';

    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('getRenderDir should include workspaceId and taskId', () => {
      const result = service.getRenderDir(workspaceId, taskId);
      expect(result).toBe(
        path.join(service['resolvedBasePath'], 'renders', workspaceId, taskId)
      );
    });

    it('getRenderInputsDir should include inputs subdirectory', () => {
      const result = service.getRenderInputsDir(workspaceId, taskId);
      expect(result).toBe(
        path.join(
          service['resolvedBasePath'],
          'renders',
          workspaceId,
          taskId,
          'inputs'
        )
      );
    });

    it('getRenderInputPath should include mediaId and extension', () => {
      const result = service.getRenderInputPath(
        workspaceId,
        taskId,
        'media789',
        'mp4'
      );
      expect(result).toBe(
        path.join(
          service['resolvedBasePath'],
          'renders',
          workspaceId,
          taskId,
          'inputs',
          'media789.mp4'
        )
      );
    });

    it('getRenderInputPath should handle leading dot in extension', () => {
      const result = service.getRenderInputPath(
        workspaceId,
        taskId,
        'media789',
        '.mp4'
      );
      expect(result).toBe(
        path.join(
          service['resolvedBasePath'],
          'renders',
          workspaceId,
          taskId,
          'inputs',
          'media789.mp4'
        )
      );
    });

    it('getRenderOutputPath should include output filename and format', () => {
      const result = service.getRenderOutputPath(workspaceId, taskId, 'mp4');
      expect(result).toBe(
        path.join(
          service['resolvedBasePath'],
          'renders',
          workspaceId,
          taskId,
          'output.mp4'
        )
      );
    });

    it('getRenderOutputPath should handle leading dot in format', () => {
      const result = service.getRenderOutputPath(workspaceId, taskId, '.mp4');
      expect(result).toBe(
        path.join(
          service['resolvedBasePath'],
          'renders',
          workspaceId,
          taskId,
          'output.mp4'
        )
      );
    });

    it('createRenderDir should call fs.promises.mkdir with workspaceId and taskId', async () => {
      const renderDir = path.join(
        service['resolvedBasePath'],
        'renders',
        workspaceId,
        taskId
      );
      const result = await service.createRenderDir(workspaceId, taskId);

      expect(fs.promises.mkdir).toHaveBeenCalledWith(renderDir, {
        recursive: true,
      });
      expect(result).toBe(renderDir);
    });
  });
});
