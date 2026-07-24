import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UploadStatus } from '@project/shared';
import { WatchFolderService } from './watch-folder.service';
import type { ConfigService } from '@nestjs/config';
import type { PocketBaseService } from '../shared/services/pocketbase.service';
import type { StorageService } from '../shared/services/storage.service';

const OLD = new Date(Date.now() - 60 * 60 * 1000);

function s3File(key: string, size = 1024) {
  return { key, size, etag: `etag-${key}`, lastModified: OLD };
}

describe('WatchFolderService', () => {
  let service: WatchFolderService;
  let config: Record<string, unknown>;

  const watchFolderImportMutator = {
    claim: vi.fn(),
    skip: vi.fn(),
    findBurnedPairs: vi.fn(),
    markImported: vi.fn(),
    markFailed: vi.fn(),
  };
  const uploadMutator = {
    create: vi.fn(),
    update: vi.fn(),
    updateStatus: vi.fn(),
  };
  const workspaceMutator = { getById: vi.fn() };
  const workspaceMemberMutator = { getFirstByFilter: vi.fn() };
  const directoryMutator = { getByWorkspace: vi.fn(), create: vi.fn() };

  const pb = {
    watchFolderImportMutator,
    uploadMutator,
    workspaceMutator,
    workspaceMemberMutator,
    directoryMutator,
  };

  const backend = { type: 's3', move: vi.fn() };
  const storage = {
    getBackend: vi.fn(() => backend),
    listFiles: vi.fn(),
  };

  const configService = {
    get: vi.fn((key: string, def?: unknown) => config[key] ?? def),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    config = {
      'watchFolder.enabled': true,
      'watchFolder.prefix': 'import/',
      'watchFolder.quietPeriodMs': 0,
      // At the fixed decorator interval, so runtime pacing never skips.
      'watchFolder.pollIntervalMs': 10000,
      'storage.s3Bucket': 'bucket',
      'storage.s3Region': 'us-east-1',
      'storage.s3Endpoint': 'https://s3.example.com',
    };

    backend.type = 's3';
    backend.move.mockResolvedValue(undefined);
    storage.getBackend.mockReturnValue(backend);
    storage.listFiles.mockResolvedValue([]);

    watchFolderImportMutator.claim.mockResolvedValue({ id: 'row1' });
    watchFolderImportMutator.skip.mockResolvedValue({ id: 'row-skip' });
    watchFolderImportMutator.findBurnedPairs.mockResolvedValue(new Set());
    watchFolderImportMutator.markImported.mockResolvedValue(undefined);
    watchFolderImportMutator.markFailed.mockResolvedValue(undefined);

    uploadMutator.create.mockResolvedValue({ id: 'up1' });
    uploadMutator.update.mockResolvedValue({ id: 'up1' });
    uploadMutator.updateStatus.mockResolvedValue(undefined);

    workspaceMutator.getById.mockResolvedValue({ id: 'ws1' });
    workspaceMemberMutator.getFirstByFilter.mockResolvedValue({
      id: 'wm1',
      UserRef: 'user1',
    });
    directoryMutator.getByWorkspace.mockResolvedValue({
      items: [],
      totalItems: 0,
      totalPages: 1,
      page: 1,
      perPage: 500,
    });
    directoryMutator.create.mockResolvedValue({ id: 'dir1' });

    service = new WatchFolderService(
      configService as unknown as ConfigService,
      pb as unknown as PocketBaseService,
      storage as unknown as StorageService
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing when ENABLE_WATCH_FOLDER is off', async () => {
    config['watchFolder.enabled'] = false;
    await service.pollIntervalTick();
    expect(storage.listFiles).not.toHaveBeenCalled();
  });

  it('hard-disables on a local storage backend', async () => {
    backend.type = 'local';
    await service.pollIntervalTick();
    await service.pollIntervalTick();
    expect(storage.listFiles).not.toHaveBeenCalled();
    // Disabled after the first tick: the second never re-checks the backend.
    expect(storage.getBackend).toHaveBeenCalledTimes(1);
  });

  it('imports a workspace-root file: claim → create(queued) → move → finalize(uploaded)', async () => {
    storage.listFiles.mockResolvedValue([s3File('import/ws1/clip.mp4')]);

    await service.pollIntervalTick();

    expect(watchFolderImportMutator.claim).toHaveBeenCalledWith({
      key: 'import/ws1/clip.mp4',
      etag: 'etag-import/ws1/clip.mp4',
      size: 1024,
      WorkspaceRef: 'ws1',
    });
    expect(uploadMutator.create).toHaveBeenCalledWith({
      name: 'clip.mp4',
      size: 1024,
      status: UploadStatus.QUEUED,
      WorkspaceRef: 'ws1',
      UserRef: 'user1',
    });
    expect(backend.move).toHaveBeenCalledWith(
      'import/ws1/clip.mp4',
      'uploads/ws1/up1/original.mp4'
    );
    expect(uploadMutator.update).toHaveBeenCalledWith(
      'up1',
      expect.objectContaining({
        status: UploadStatus.UPLOADED,
        storageBackend: 's3',
        externalPath: 'uploads/ws1/up1/original.mp4',
        bytesUploaded: 1024,
        storageConfig: expect.objectContaining({ bucket: 'bucket' }),
      })
    );
    expect(watchFolderImportMutator.markImported).toHaveBeenCalledWith(
      'row1',
      'up1'
    );

    // The move must precede the hook-triggering finalize.
    const moveOrder = backend.move.mock.invocationCallOrder[0];
    const finalizeOrder = uploadMutator.update.mock.invocationCallOrder[0];
    expect(moveOrder).toBeLessThan(finalizeOrder);
  });

  it('maps a subfolder to a Directory and sets DirectoryRef', async () => {
    storage.listFiles.mockResolvedValue([
      s3File('import/ws1/My Folder/clip.mp4'),
    ]);

    await service.pollIntervalTick();

    expect(directoryMutator.create).toHaveBeenCalledWith({
      WorkspaceRef: 'ws1',
      name: 'My-Folder',
    });
    expect(uploadMutator.create).toHaveBeenCalledWith(
      expect.objectContaining({ DirectoryRef: 'dir1' })
    );
  });

  it('reuses an existing Directory case-insensitively', async () => {
    directoryMutator.getByWorkspace.mockResolvedValue({
      items: [{ id: 'dir-existing', name: 'my-folder' }],
      totalItems: 1,
      totalPages: 1,
      page: 1,
      perPage: 500,
    });
    storage.listFiles.mockResolvedValue([
      s3File('import/ws1/My-Folder/clip.mp4'),
    ]);

    await service.pollIntervalTick();

    expect(directoryMutator.create).not.toHaveBeenCalled();
    expect(uploadMutator.create).toHaveBeenCalledWith(
      expect.objectContaining({ DirectoryRef: 'dir-existing' })
    );
  });

  it('short-circuits when the claim is lost (no Upload, no move)', async () => {
    watchFolderImportMutator.claim.mockResolvedValue(null);
    storage.listFiles.mockResolvedValue([s3File('import/ws1/clip.mp4')]);

    await service.pollIntervalTick();

    expect(uploadMutator.create).not.toHaveBeenCalled();
    expect(backend.move).not.toHaveBeenCalled();
  });

  it('never touches pairs the ledger already knows', async () => {
    const f = s3File('import/ws1/clip.mp4');
    watchFolderImportMutator.findBurnedPairs.mockResolvedValue(
      new Set([`${f.key}\n${f.etag}`])
    );
    storage.listFiles.mockResolvedValue([f]);

    await service.pollIntervalTick();
    await service.pollIntervalTick();

    expect(watchFolderImportMutator.claim).not.toHaveBeenCalled();
    expect(backend.move).not.toHaveBeenCalled();
    // Second tick answers from the in-memory burned cache.
    expect(watchFolderImportMutator.findBurnedPairs).toHaveBeenCalledTimes(1);
  });

  it('marks Upload and ledger failed when the move fails; never finalizes', async () => {
    backend.move.mockRejectedValue(new Error('copy exploded'));
    storage.listFiles.mockResolvedValue([s3File('import/ws1/clip.mp4')]);

    await service.pollIntervalTick();

    expect(uploadMutator.updateStatus).toHaveBeenCalledWith(
      'up1',
      UploadStatus.FAILED,
      expect.stringContaining('copy exploded')
    );
    expect(watchFolderImportMutator.markFailed).toHaveBeenCalledWith(
      'row1',
      expect.stringContaining('copy exploded')
    );
    expect(uploadMutator.update).not.toHaveBeenCalled();
  });

  it('records the destination when finalize fails after a successful move', async () => {
    vi.useFakeTimers();
    uploadMutator.update.mockRejectedValue(new Error('pb down'));
    storage.listFiles.mockResolvedValue([s3File('import/ws1/clip.mp4')]);

    const tick = service.pollIntervalTick();
    await vi.runAllTimersAsync();
    await tick;

    expect(uploadMutator.update).toHaveBeenCalledTimes(3); // retried
    expect(watchFolderImportMutator.markFailed).toHaveBeenCalledWith(
      'row1',
      expect.stringContaining('moved to uploads/ws1/up1/original.mp4')
    );
  });

  it('leaves unknown-workspace files untouched and unburned', async () => {
    workspaceMutator.getById.mockResolvedValue(null);
    storage.listFiles.mockResolvedValue([
      s3File('import/nope/clip.mp4'),
      s3File('import/nope/other.mp4'),
    ]);

    await service.pollIntervalTick();

    expect(watchFolderImportMutator.claim).not.toHaveBeenCalled();
    expect(watchFolderImportMutator.skip).not.toHaveBeenCalled();
    expect(backend.move).not.toHaveBeenCalled();
    // Per-tick workspace cache: one lookup for both files.
    expect(workspaceMutator.getById).toHaveBeenCalledTimes(1);
  });

  it('burns unsupported extensions via a skipped ledger row, leaving the object', async () => {
    storage.listFiles.mockResolvedValue([s3File('import/ws1/notes.txt')]);

    await service.pollIntervalTick();

    expect(watchFolderImportMutator.skip).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'import/ws1/notes.txt',
        WorkspaceRef: 'ws1',
      }),
      expect.stringContaining('txt')
    );
    expect(backend.move).not.toHaveBeenCalled();
    expect(uploadMutator.create).not.toHaveBeenCalled();
  });

  it('does not burn structural rejects inside an unknown workspace', async () => {
    workspaceMutator.getById.mockResolvedValue(null);
    storage.listFiles.mockResolvedValue([s3File('import/nope/notes.txt')]);

    await service.pollIntervalTick();

    expect(watchFolderImportMutator.skip).not.toHaveBeenCalled();
  });

  it('is re-entrancy guarded: overlapping ticks do not double-list', async () => {
    let release!: () => void;
    storage.listFiles.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve([]);
        })
    );

    const first = service.pollIntervalTick();
    const second = service.pollIntervalTick();
    expect(storage.listFiles).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
  });
});
