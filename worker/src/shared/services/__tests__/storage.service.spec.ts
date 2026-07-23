import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StorageService } from '../storage.service';
import { StorageBackendType } from '@project/shared';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Writable } from 'stream';
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

vi.mock('@project/shared/storage', async (importOriginal) => {
  // Spread the real module so non-stubbed exports (e.g.
  // resolveLocalStorageBasePath) keep working; only override the backend.
  const actual = await importOriginal<object>();
  return {
    ...actual,
    createStorageBackend: vi.fn().mockImplementation(async () => {
      // Call initialize when backend is created (mimicking real behavior)
      await mockStorageBackend.initialize();
      return mockStorageBackend;
    }),
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
vi.mock('fs', async (importOriginal) => {
  // Spread the real fs: the shared LocalStorageBackend promisifies fs.mkdir
  // etc. at module load, so a bare stub object breaks module evaluation.
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    createWriteStream: vi.fn(),
    promises: {
      ...actual.promises,
      mkdir: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue(Buffer.from('test data')),
      rm: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
    },
  };
});

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

      // Mock fs operations. downloadToTemp pipes the download through
      // stream.pipeline, which needs a real Writable and a real web
      // ReadableStream (Readable.fromWeb rejects hand-rolled fakes).
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const discardStream = new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      });
      vi.mocked(fs.createWriteStream).mockReturnValue(discardStream as any);

      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      });
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

  describe('downloadToTemp robustness', () => {
    const params = {
      storagePath: 'uploads/workspace1/upload1/original.mp4',
      storageBackend: StorageBackendType.S3,
      recordId: 'media1',
    };

    const okStream = () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      });

    const failingStream = () =>
      new ReadableStream({
        start(controller) {
          controller.error(new Error('stream reset'));
        },
      });

    beforeEach(async () => {
      await service.onModuleInit();
      getMockStorageBackend().type = StorageBackendType.S3;
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.createWriteStream).mockImplementation(
        () =>
          new Writable({
            write(_chunk, _encoding, callback) {
              callback();
            },
          }) as any
      );
      getMockStorageBackend().download.mockImplementation(async () =>
        okStream()
      );
    });

    it('shares one in-flight download between concurrent resolves', async () => {
      const [a, b] = await Promise.all([
        service.resolveFilePath(params),
        service.resolveFilePath(params),
      ]);

      expect(a).toBe(b);
      expect(getMockStorageBackend().download).toHaveBeenCalledTimes(1);
    });

    it('downloads again after the previous transfer settles', async () => {
      await service.resolveFilePath(params);
      await service.resolveFilePath(params);

      expect(getMockStorageBackend().download).toHaveBeenCalledTimes(2);
    });

    it('writes to a unique .part file and renames it into place', async () => {
      const result = await service.resolveFilePath(params);

      const partPath = vi.mocked(fs.createWriteStream).mock
        .calls[0][0] as string;
      expect(partPath).toMatch(/original\.mp4\.[0-9a-f-]{36}\.part$/);
      expect(fs.promises.rename).toHaveBeenCalledWith(partPath, result);
    });

    it('retries a transiently failed download and removes its part file', async () => {
      getMockStorageBackend()
        .download.mockImplementationOnce(async () => failingStream())
        .mockImplementationOnce(async () => okStream());

      const result = await service.resolveFilePath(params);

      expect(result).toContain('media1');
      expect(getMockStorageBackend().download).toHaveBeenCalledTimes(2);
      const failedPart = vi.mocked(fs.createWriteStream).mock
        .calls[0][0] as string;
      expect(fs.promises.rm).toHaveBeenCalledWith(failedPart, { force: true });
    });

    it('throws the last error once retries are exhausted', async () => {
      getMockStorageBackend().download.mockImplementation(async () =>
        failingStream()
      );

      await expect(service.resolveFilePath(params)).rejects.toThrow(
        'stream reset'
      );
      expect(getMockStorageBackend().download).toHaveBeenCalledTimes(3);
    });
  });

  describe('temp leases and cleanupTemp', () => {
    const tempDirFor = (recordId: string) =>
      path.join(os.tmpdir(), 'worker-temp', recordId);

    beforeEach(async () => {
      await service.onModuleInit();
      vi.mocked(fs.existsSync).mockReturnValue(true);
    });

    it('deletes immediately when no lease is held', async () => {
      await service.cleanupTemp('media1');

      expect(fs.promises.rm).toHaveBeenCalledWith(tempDirFor('media1'), {
        recursive: true,
        force: true,
      });
    });

    it('defers cleanup while a lease is held and deletes on release', async () => {
      await service.withTempLease('media1', async () => {
        await service.cleanupTemp('media1');
        expect(fs.promises.rm).not.toHaveBeenCalled();
      });

      expect(fs.promises.rm).toHaveBeenCalledWith(tempDirFor('media1'), {
        recursive: true,
        force: true,
      });
    });

    it('waits for the LAST lease holder before deleting', async () => {
      await service.withTempLease('media1', async () => {
        await service.withTempLease('media1', async () => {
          await service.cleanupTemp('media1');
        });
        // Inner lease released, outer still held: nothing deleted yet.
        expect(fs.promises.rm).not.toHaveBeenCalled();
      });

      expect(fs.promises.rm).toHaveBeenCalledTimes(1);
    });

    it('does not delete on release when no cleanup was requested', async () => {
      await service.withTempLease('media1', async () => {});

      expect(fs.promises.rm).not.toHaveBeenCalled();
    });

    it('scopes leases per record', async () => {
      await service.withTempLease('media1', async () => {
        await service.cleanupTemp('media2');
        expect(fs.promises.rm).toHaveBeenCalledWith(tempDirFor('media2'), {
          recursive: true,
          force: true,
        });
      });
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
