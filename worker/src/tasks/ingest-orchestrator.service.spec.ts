import { expect, vi, describe, it, beforeEach } from 'vitest';
import { TaskType, type Task } from '@project/shared';
import { IngestOrchestratorService } from './ingest-orchestrator.service';
import { PocketBaseService } from '../shared/services/pocketbase.service';
import { QueueService } from '../queue/queue.service';

type AnyFn = ReturnType<typeof vi.fn>;

describe('IngestOrchestratorService', () => {
  let service: IngestOrchestratorService;

  const taskMutator = {
    createProcessUploadTask: vi.fn(),
    createDetectLabelsTask: vi.fn(),
    markSuccess: vi.fn(),
    markFailed: vi.fn(),
  };

  const pb = {
    taskMutator,
    getUpload: vi.fn(),
    getMediaByUpload: vi.fn(),
    createMedia: vi.fn(),
    updateTask: vi.fn(),
  };

  const queueService = {
    enqueueTask: vi.fn(),
  };

  const fullIngestTask = {
    id: 'fi-1',
    type: TaskType.FULL_INGEST,
    sourceId: 'u-1',
    UserRef: 'user-1',
    payload: { uploadId: 'u-1' },
  } as unknown as Task;

  const videoUpload = {
    id: 'u-1',
    name: 'clip.mp4',
    WorkspaceRef: 'w-1',
    UserRef: 'user-1',
    externalPath: 'w-1/u-1/clip.mp4',
    DirectoryRef: 'dir-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    taskMutator.createProcessUploadTask.mockResolvedValue({ id: 'pu-1' });
    taskMutator.createDetectLabelsTask.mockResolvedValue({ id: 'dl-1' });
    taskMutator.markSuccess.mockResolvedValue(undefined);
    taskMutator.markFailed.mockResolvedValue(undefined);
    pb.getMediaByUpload.mockResolvedValue(null);
    pb.createMedia.mockResolvedValue({ id: 'm-1' });
    pb.updateTask.mockResolvedValue(undefined);
    queueService.enqueueTask.mockResolvedValue('job-1');

    service = new IngestOrchestratorService(
      pb as unknown as PocketBaseService,
      queueService as unknown as QueueService
    );
  });

  it('creates a placeholder Media (with DirectoryRef) and fans out transcode + labels for a video', async () => {
    pb.getUpload.mockResolvedValue(videoUpload);

    await service.orchestrate(fullIngestTask);

    expect(pb.createMedia).toHaveBeenCalledTimes(1);
    const mediaInput = pb.createMedia.mock.calls[0][0];
    expect(mediaInput.UploadRef).toBe('u-1');
    expect(mediaInput.DirectoryRef).toBe('dir-1');
    expect(mediaInput.isActive).toBe(false);

    expect(taskMutator.createProcessUploadTask).toHaveBeenCalledTimes(1);
    expect(taskMutator.createDetectLabelsTask).toHaveBeenCalledTimes(1);
    // Two child tasks enqueued immediately
    expect(queueService.enqueueTask).toHaveBeenCalledTimes(2);
    expect(taskMutator.markSuccess).toHaveBeenCalledWith(
      'fi-1',
      expect.objectContaining({ mediaId: 'm-1', uploadId: 'u-1' })
    );
  });

  it('skips label detection for images', async () => {
    pb.getUpload.mockResolvedValue({ ...videoUpload, name: 'photo.jpg' });

    await service.orchestrate(fullIngestTask);

    expect(taskMutator.createProcessUploadTask).toHaveBeenCalledTimes(1);
    expect(taskMutator.createDetectLabelsTask).not.toHaveBeenCalled();
    expect(queueService.enqueueTask).toHaveBeenCalledTimes(1);
  });

  it('skips label detection when the upload has no externalPath', async () => {
    pb.getUpload.mockResolvedValue({ ...videoUpload, externalPath: '' });

    await service.orchestrate(fullIngestTask);

    expect(taskMutator.createDetectLabelsTask).not.toHaveBeenCalled();
  });

  it('reuses existing Media instead of creating a new one (idempotent re-ingest)', async () => {
    pb.getUpload.mockResolvedValue(videoUpload);
    pb.getMediaByUpload.mockResolvedValue({ id: 'm-existing' });

    await service.orchestrate(fullIngestTask);

    expect(pb.createMedia).not.toHaveBeenCalled();
    expect(taskMutator.createProcessUploadTask).toHaveBeenCalledTimes(1);
  });

  it('marks the full_ingest task failed when the upload is missing', async () => {
    pb.getUpload.mockResolvedValue(null);

    await service.orchestrate(fullIngestTask);

    expect(taskMutator.markFailed).toHaveBeenCalledTimes(1);
    expect(taskMutator.markSuccess).not.toHaveBeenCalled();
    expect(taskMutator.createProcessUploadTask).not.toHaveBeenCalled();
  });

  it('leaves a child queued (for the poll loop) if immediate enqueue fails, and still succeeds', async () => {
    pb.getUpload.mockResolvedValue(videoUpload);
    (queueService.enqueueTask as AnyFn).mockRejectedValue(
      new Error('redis down')
    );

    await service.orchestrate(fullIngestTask);

    // Child tasks were still created; orchestration itself succeeds.
    expect(taskMutator.createProcessUploadTask).toHaveBeenCalledTimes(1);
    expect(taskMutator.markSuccess).toHaveBeenCalledTimes(1);
    expect(taskMutator.markFailed).not.toHaveBeenCalled();
  });
});
