import { expect, vi, describe, it, beforeEach } from 'vitest';
import { TaskType, FileStatus, FileType, type Task } from '@project/shared';
import { CleanupOrchestratorService } from './cleanup-orchestrator.service';
import { PocketBaseService } from '../shared/services/pocketbase.service';
import { StorageService } from '../shared/services/storage.service';

const emptyPage = { items: [], totalItems: 0, page: 1, perPage: 200 };
const page = (items: unknown[]) => ({
  items,
  totalItems: items.length,
  page: 1,
  perPage: 200,
});

describe('CleanupOrchestratorService', () => {
  let service: CleanupOrchestratorService;

  const taskMutator = {
    markSuccess: vi.fn(),
    markFailed: vi.fn(),
  };
  const mediaMutator = { getList: vi.fn() };
  const fileMutator = { getById: vi.fn(), update: vi.fn(), getList: vi.fn() };
  const timelineRenderMutator = { getList: vi.fn() };
  const artifactMutator = {
    getPending: vi.fn(),
    delete: vi.fn(),
    markFailed: vi.fn(),
  };

  const filterFn = vi.fn((s: string, _params?: Record<string, unknown>) => s);
  const pb = {
    taskMutator,
    mediaMutator,
    fileMutator,
    timelineRenderMutator,
    artifactMutator,
    updateTask: vi.fn(),
    deleteFile: vi.fn(),
    getClient: vi.fn(() => ({ filter: filterFn })),
  };

  const storage = {
    delete: vi.fn(),
    cleanupStaleWorkingDirs: vi.fn(),
    reconcileLocal: vi.fn(),
  };

  const cleanupTask = {
    id: 'cl-1',
    type: TaskType.CLEANUP,
    payload: {},
  } as unknown as Task;

  beforeEach(() => {
    vi.clearAllMocks();
    // Defaults: everything empty / no-op. Individual tests override.
    mediaMutator.getList.mockResolvedValue(emptyPage);
    fileMutator.getById.mockResolvedValue(null);
    fileMutator.update.mockResolvedValue(undefined);
    fileMutator.getList.mockResolvedValue(emptyPage);
    timelineRenderMutator.getList.mockResolvedValue(emptyPage);
    artifactMutator.getPending.mockResolvedValue(emptyPage);
    artifactMutator.delete.mockResolvedValue(true);
    artifactMutator.markFailed.mockResolvedValue(undefined);
    pb.updateTask.mockResolvedValue(undefined);
    pb.deleteFile.mockResolvedValue(true);
    storage.delete.mockResolvedValue(undefined);
    storage.cleanupStaleWorkingDirs.mockResolvedValue(0);
    storage.reconcileLocal.mockResolvedValue(0);
    taskMutator.markSuccess.mockResolvedValue(undefined);
    taskMutator.markFailed.mockResolvedValue(undefined);

    service = new CleanupOrchestratorService(
      pb as unknown as PocketBaseService,
      storage as unknown as StorageService
    );
  });

  it('runs all steps and reports counts via markSuccess', async () => {
    // Backfill: one Media with an unlinked proxy file and an already-linked strip.
    mediaMutator.getList.mockResolvedValueOnce(
      page([{ id: 'm-1', proxyFileRef: 'f-1', filmstripFileRefs: ['f-2'] }])
    );
    fileMutator.getById.mockImplementation(async (id: string) =>
      id === 'f-1'
        ? { id: 'f-1', MediaRef: undefined }
        : { id: 'f-2', MediaRef: 'm-1' }
    );

    // Prune: two stale files, then empty.
    fileMutator.getList
      .mockResolvedValueOnce(page([{ id: 'del-1' }, { id: 'del-2' }]))
      .mockResolvedValue(emptyPage);

    // Drain: two pending artifacts, then empty.
    artifactMutator.getPending
      .mockResolvedValueOnce(
        page([
          { id: 'a-1', storageKey: 'k1', attempts: 0 },
          { id: 'a-2', storageKey: 'k2', attempts: 0 },
        ])
      )
      .mockResolvedValue(emptyPage);

    storage.reconcileLocal.mockResolvedValue(4);
    storage.cleanupStaleWorkingDirs.mockResolvedValue(3);

    await service.run(cleanupTask);

    expect(fileMutator.update).toHaveBeenCalledWith('f-1', { MediaRef: 'm-1' });
    expect(pb.deleteFile).toHaveBeenCalledTimes(2);
    expect(storage.delete).toHaveBeenCalledWith('k1');
    expect(storage.delete).toHaveBeenCalledWith('k2');
    expect(artifactMutator.delete).toHaveBeenCalledTimes(2);

    expect(taskMutator.markSuccess).toHaveBeenCalledWith('cl-1', {
      refsLinked: 1,
      staleFilesPruned: 2,
      unreferencedFilesPruned: 0,
      artifactsDeleted: 2,
      artifactsFailed: 0,
      localDirsPurged: 4,
      tempDirsRemoved: 3,
    });
    expect(taskMutator.markFailed).not.toHaveBeenCalled();
  });

  it('reconciles local storage using keep-sets built from live records', async () => {
    // One live Media (m-1) belonging to upload u-1 (consumed by the backfill
    // scan and the keep-set collector — return it for every Media page).
    mediaMutator.getList.mockResolvedValue(
      page([{ id: 'm-1', UploadRef: 'u-1' }])
    );
    // fileMutator.getList (prune + sweep candidates) stays empty.
    fileMutator.getList.mockResolvedValue(emptyPage);
    storage.reconcileLocal.mockResolvedValue(2);

    await service.run(cleanupTask);

    const [keep] = storage.reconcileLocal.mock.calls[0];
    expect([...keep.uploadIds]).toEqual(['u-1']);
    expect([...keep.mediaIds]).toEqual(['m-1']);
    expect(keep).not.toHaveProperty('renderPrefixes');
    expect(pb.deleteFile).not.toHaveBeenCalled(); // prune saw no stale files
    expect(taskMutator.markSuccess).toHaveBeenCalledWith(
      'cl-1',
      expect.objectContaining({ localDirsPurged: 2 })
    );
  });

  it('claims the task (marks it running) before doing any work', async () => {
    await service.run(cleanupTask);

    expect(pb.updateTask).toHaveBeenCalledWith('cl-1', { status: 'running' });
    const claimOrder = pb.updateTask.mock.invocationCallOrder[0];
    const drainOrder = artifactMutator.getPending.mock.invocationCallOrder[0];
    expect(claimOrder).toBeLessThan(drainOrder);
  });

  it('still runs (best-effort) when claiming the task fails', async () => {
    pb.updateTask.mockRejectedValueOnce(new Error('pb blip'));

    await service.run(cleanupTask);

    expect(taskMutator.markSuccess).toHaveBeenCalledTimes(1);
    expect(taskMutator.markFailed).not.toHaveBeenCalled();
  });

  it('treats an already-deleted blob as success (idempotent)', async () => {
    artifactMutator.getPending
      .mockResolvedValueOnce(
        page([{ id: 'a-1', storageKey: 'gone', attempts: 0 }])
      )
      .mockResolvedValue(emptyPage);
    storage.delete.mockRejectedValueOnce(new Error('ENOENT: no such file'));

    await service.run(cleanupTask);

    expect(artifactMutator.delete).toHaveBeenCalledWith('a-1');
    expect(artifactMutator.markFailed).not.toHaveBeenCalled();
    expect(taskMutator.markSuccess).toHaveBeenCalledWith(
      'cl-1',
      expect.objectContaining({ artifactsDeleted: 1, artifactsFailed: 0 })
    );
  });

  it('marks an artifact failed on a real storage error (and keeps the row)', async () => {
    artifactMutator.getPending
      .mockResolvedValueOnce(
        page([{ id: 'a-1', storageKey: 'k1', attempts: 1 }])
      )
      .mockResolvedValue(emptyPage);
    storage.delete.mockRejectedValueOnce(new Error('connection reset'));

    await service.run(cleanupTask);

    expect(artifactMutator.markFailed).toHaveBeenCalledWith(
      'a-1',
      'connection reset',
      1
    );
    expect(artifactMutator.delete).not.toHaveBeenCalled();
    expect(taskMutator.markSuccess).toHaveBeenCalledWith(
      'cl-1',
      expect.objectContaining({ artifactsDeleted: 0, artifactsFailed: 1 })
    );
  });

  it('prunes stale files using a DELETED-or-aged-FAILED filter', async () => {
    fileMutator.getList
      .mockResolvedValueOnce(page([{ id: 'del-1' }]))
      .mockResolvedValue(emptyPage);

    await service.run(cleanupTask);

    // The PB filter is built with the DELETED and FAILED statuses.
    const filterArgs = filterFn.mock.calls[0];
    expect(filterArgs[1]).toEqual(
      expect.objectContaining({
        deleted: FileStatus.DELETED,
        failed: FileStatus.FAILED,
      })
    );
    expect(pb.deleteFile).toHaveBeenCalledWith('del-1');
  });

  it('prunes unreferenced derived files but keeps referenced ones', async () => {
    // m-1 still points at f-keep; render r-1 still points at f-render.
    mediaMutator.getList.mockResolvedValue(
      page([{ id: 'm-1', UploadRef: 'u-1', proxyFileRef: 'f-keep' }])
    );
    fileMutator.getById.mockResolvedValue({ id: 'f-keep', MediaRef: 'm-1' });
    timelineRenderMutator.getList.mockResolvedValue(
      page([{ id: 'r-1', FileRef: 'f-render' }])
    );
    // pruneStaleFiles sees nothing; the sweep sees three aged derived files,
    // of which only f-old (a superseded proxy) is unreferenced.
    fileMutator.getList
      .mockResolvedValueOnce(emptyPage)
      .mockResolvedValueOnce(
        page([{ id: 'f-keep' }, { id: 'f-old' }, { id: 'f-render' }])
      )
      .mockResolvedValue(emptyPage);

    await service.run(cleanupTask);

    expect(pb.deleteFile).toHaveBeenCalledTimes(1);
    expect(pb.deleteFile).toHaveBeenCalledWith('f-old');
    expect(taskMutator.markSuccess).toHaveBeenCalledWith(
      'cl-1',
      expect.objectContaining({ unreferencedFilesPruned: 1 })
    );

    // The sweep filter targets derived types only, older than the grace window.
    const sweepFilterArgs = filterFn.mock.calls[filterFn.mock.calls.length - 1];
    expect(sweepFilterArgs?.[0]).toContain('created < {:cutoff}');
    expect(sweepFilterArgs?.[0]).not.toContain(FileType.ORIGINAL);
    expect(sweepFilterArgs?.[1]).toEqual(
      expect.objectContaining({
        type0: FileType.PROXY,
        type5: FileType.RENDER,
        cutoff: expect.any(String),
      })
    );
  });

  it('marks the task failed on an unexpected top-level error', async () => {
    storage.cleanupStaleWorkingDirs.mockRejectedValue(new Error('disk gone'));

    await service.run(cleanupTask);

    expect(taskMutator.markFailed).toHaveBeenCalledWith('cl-1', 'disk gone');
    expect(taskMutator.markSuccess).not.toHaveBeenCalled();
  });
});
