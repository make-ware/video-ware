import { ConfigService } from '@nestjs/config';
import { FileType } from '@project/shared';
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

vi.mock('@project/shared/storage', async (importOriginal) => ({
  // Spread the real module so non-stubbed exports (e.g.
  // resolveLocalStorageBasePath) keep working.
  ...(await importOriginal<object>()),
  createStorageBackend: vi.fn(),
  LocalStorageBackend: class {},
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    promises: {
      ...actual.promises,
      rm: vi.fn().mockResolvedValue(undefined),
      rmdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
      stat: vi.fn().mockResolvedValue({ mtimeMs: 0 }),
    },
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

  it('removes the render directory in local mode too (working dir, not durable)', async () => {
    const service = buildService('local');
    await service.onModuleInit();

    vi.mocked(fs.existsSync).mockReturnValue(true);

    await service.cleanupRenderDir('ws1', 'task1');

    expect(fs.promises.rm).toHaveBeenCalledWith(
      expect.stringContaining('renders/ws1/task1'),
      { recursive: true, force: true }
    );
  });
});

describe('StorageService.cleanupTranscodeDir', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const storageModule = await import('@project/shared/storage');
    (storageModule.createStorageBackend as any).mockImplementation(
      (config: { type: string }) =>
        Promise.resolve({ type: config.type, exists: vi.fn() })
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it('removes the transcode working directory in local mode (PocketBase holds the durable copy)', async () => {
    const service = buildService('local');
    await service.onModuleInit();

    vi.mocked(fs.existsSync).mockReturnValue(true);

    await service.cleanupTranscodeDir('ws1', 'up1');

    expect(fs.promises.rm).toHaveBeenCalledWith(
      expect.stringContaining('transcode/ws1/up1'),
      { recursive: true, force: true }
    );
  });

  it('removes the transcode working directory in S3 mode too', async () => {
    const service = buildService('s3');
    await service.onModuleInit();

    vi.mocked(fs.existsSync).mockReturnValue(true);

    await service.cleanupTranscodeDir('ws1', 'up1');

    expect(fs.promises.rm).toHaveBeenCalledWith(
      expect.stringContaining('transcode/ws1/up1'),
      { recursive: true, force: true }
    );
  });

  it('does not call rm when the directory does not exist', async () => {
    const service = buildService('local');
    await service.onModuleInit();

    vi.mocked(fs.existsSync).mockReturnValue(false);

    await service.cleanupTranscodeDir('ws1', 'up1');

    expect(fs.promises.rm).not.toHaveBeenCalled();
  });
});

describe('StorageService.cleanupStaleWorkingDirs', () => {
  const dirent = (name: string) => ({ name, isDirectory: () => true });

  beforeEach(async () => {
    vi.clearAllMocks();
    const storageModule = await import('@project/shared/storage');
    (storageModule.createStorageBackend as any).mockImplementation(
      (config: { type: string }) =>
        Promise.resolve({ type: config.type, exists: vi.fn() })
    );
    // mtime 0 -> always older than any cutoff -> stale.
    vi.mocked(fs.promises.stat).mockResolvedValue({ mtimeMs: 0 } as fs.Stats);
  });

  afterEach(() => vi.restoreAllMocks());

  it('sweeps stale render working dirs on the local backend', async () => {
    const service = buildService('local');
    await service.onModuleInit();

    vi.mocked(fs.promises.readdir).mockImplementation((async (
      p: fs.PathLike,
      opts?: unknown
    ) => {
      if (!opts) return [];
      const s = String(p);
      if (s.endsWith('/renders')) return [dirent('ws1')];
      if (s.endsWith('/renders/ws1')) return [dirent('task-old')];
      return []; // worker-temp and everything else empty
    }) as unknown as typeof fs.promises.readdir);

    const removed = await service.cleanupStaleWorkingDirs(24 * 60 * 60 * 1000);

    expect(removed).toBe(1);
    expect(fs.promises.rm).toHaveBeenCalledWith(
      expect.stringContaining('renders/ws1/task-old'),
      { recursive: true, force: true }
    );
  });

  it('keeps render working dirs younger than the grace window', async () => {
    const service = buildService('local');
    await service.onModuleInit();
    vi.mocked(fs.promises.stat).mockResolvedValue({
      mtimeMs: Date.now(),
    } as fs.Stats);

    vi.mocked(fs.promises.readdir).mockImplementation((async (
      p: fs.PathLike,
      opts?: unknown
    ) => {
      if (!opts) return [];
      const s = String(p);
      if (s.endsWith('/renders')) return [dirent('ws1')];
      if (s.endsWith('/renders/ws1')) return [dirent('task-fresh')];
      return [];
    }) as unknown as typeof fs.promises.readdir);

    const removed = await service.cleanupStaleWorkingDirs(24 * 60 * 60 * 1000);

    expect(removed).toBe(0);
    expect(fs.promises.rm).not.toHaveBeenCalled();
  });
});

describe('StorageService.transcodeStorageKey', () => {
  it('keys derived transcode outputs under transcode/, not uploads/', () => {
    const service = buildService('local');
    expect(
      service.transcodeStorageKey('ws1', 'up1', FileType.PROXY, 'proxy.mp4')
    ).toBe('transcode/ws1/up1/proxy/proxy.mp4');
  });
});

describe('StorageService.reconcileLocal', () => {
  const dirent = (name: string) => ({ name, isDirectory: () => true });

  beforeEach(async () => {
    vi.clearAllMocks();
    const storageModule = await import('@project/shared/storage');
    (storageModule.createStorageBackend as any).mockImplementation(
      (config: { type: string }) =>
        Promise.resolve({ type: config.type, exists: vi.fn() })
    );
    // Two ids under each top-level: one live, one orphaned.
    vi.mocked(fs.promises.readdir).mockImplementation((async (
      p: fs.PathLike,
      opts?: unknown
    ) => {
      const s = String(p);
      // The empty-check readdir (no withFileTypes) returns plain names; keep
      // workspace dirs non-empty so we don't assert on rmdir here.
      if (!opts) return ['x'];
      if (s.endsWith('/uploads') || s.endsWith('/transcode'))
        return [dirent('ws1')];
      if (s.endsWith('/uploads/ws1') || s.endsWith('/transcode/ws1'))
        return [dirent('live-up'), dirent('dead-up')];
      if (s.endsWith('/renders')) return [dirent('ws1')];
      if (s.endsWith('/renders/ws1'))
        return [dirent('live-task'), dirent('dead-task')];
      if (s.endsWith('/labels')) return [dirent('ws1')];
      if (s.endsWith('/labels/ws1'))
        return [dirent('live-media'), dirent('dead-media')];
      return [];
    }) as unknown as typeof fs.promises.readdir);
    vi.mocked(fs.promises.stat).mockResolvedValue({
      mtimeMs: 0,
    } as fs.Stats);
  });

  afterEach(() => vi.restoreAllMocks());

  it('is a no-op on the S3 backend', async () => {
    const service = buildService('s3');
    await service.onModuleInit();

    const purged = await service.reconcileLocal(
      { uploadIds: new Set(), mediaIds: new Set() },
      0
    );

    expect(purged).toBe(0);
    expect(fs.promises.rm).not.toHaveBeenCalled();
  });

  it('purges orphaned upload/transcode dirs but keeps live dirs and labels for existing media', async () => {
    const service = buildService('local');
    await service.onModuleInit();

    const purged = await service.reconcileLocal(
      {
        uploadIds: new Set(['live-up']),
        mediaIds: new Set(['live-media']),
      },
      24 * 60 * 60 * 1000
    );

    const removed = vi
      .mocked(fs.promises.rm)
      .mock.calls.map((c) => String(c[0]));
    const removedHas = (sub: string) => removed.some((p) => p.includes(sub));

    // Orphans purged across uploads, transcode, labels.
    expect(removedHas('uploads/ws1/dead-up')).toBe(true);
    expect(removedHas('transcode/ws1/dead-up')).toBe(true);
    expect(removedHas('labels/ws1/dead-media')).toBe(true);
    // Live entities kept — including labels for the existing Media.
    expect(removedHas('uploads/ws1/live-up')).toBe(false);
    expect(removedHas('transcode/ws1/live-up')).toBe(false);
    expect(removedHas('labels/ws1/live-media')).toBe(false);
    // renders/ is no longer reconciled here (handled by cleanupStaleWorkingDirs).
    expect(removedHas('renders/ws1')).toBe(false);
    expect(purged).toBe(3);
  });

  it('skips dirs younger than the grace window (possible in-flight work)', async () => {
    const service = buildService('local');
    await service.onModuleInit();
    vi.mocked(fs.promises.stat).mockResolvedValue({
      mtimeMs: Date.now(),
    } as fs.Stats);

    const purged = await service.reconcileLocal(
      { uploadIds: new Set(), mediaIds: new Set() },
      24 * 60 * 60 * 1000
    );

    expect(purged).toBe(0);
    expect(fs.promises.rm).not.toHaveBeenCalled();
  });
});
