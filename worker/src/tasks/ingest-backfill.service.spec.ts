import { expect, vi, describe, it, beforeEach } from 'vitest';
import {
  INGEST_STEP_VERSIONS,
  MediaType,
  TaskStatus,
  TaskType,
  type IngestBackfillResult,
  type Task,
} from '@project/shared';
import { TranscodeStepType } from '@project/shared/jobs';
import { IngestBackfillService } from './ingest-backfill.service';
import { PocketBaseService } from '../shared/services/pocketbase.service';

const emptyPage = { items: [], totalItems: 0, page: 1, perPage: 100 };
const page = (items: unknown[]) => ({
  items,
  totalItems: items.length,
  page: 1,
  perPage: 100,
});

/** A video media with every ingest asset present and current. */
function fullyIngestedVideo(overrides: Record<string, unknown> = {}) {
  const current = (step: keyof typeof INGEST_STEP_VERSIONS) => ({
    id: `f-${step}`,
    meta: { ingestVersion: INGEST_STEP_VERSIONS[step] },
  });

  return {
    id: 'm-1',
    mediaType: MediaType.VIDEO,
    hasAudio: true,
    WorkspaceRef: 'ws-1',
    UploadRef: 'up-1',
    thumbnailFileRef: 'f-thumb',
    spriteFileRef: 'f-sprite',
    filmstripFileRefs: ['f-strip'],
    waveformFileRefs: ['f-wave'],
    proxyFileRef: 'f-proxy',
    audioFileRef: 'f-audio',
    expand: {
      UploadRef: { id: 'up-1', UserRef: 'user-1' },
      thumbnailFileRef: current(TranscodeStepType.THUMBNAIL),
      spriteFileRef: current(TranscodeStepType.SPRITE),
      filmstripFileRefs: [current(TranscodeStepType.FILMSTRIP)],
      waveformFileRefs: [current(TranscodeStepType.WAVEFORM)],
      proxyFileRef: current(TranscodeStepType.TRANSCODE),
      audioFileRef: current(TranscodeStepType.AUDIO),
    },
    ...overrides,
  };
}

/** The same media with no waveform at all (ingested before waveforms existed). */
function videoMissingWaveform() {
  const media = fullyIngestedVideo();
  const { waveformFileRefs: _refs, ...rest } = media;
  const { waveformFileRefs: _expanded, ...expandRest } = media.expand;
  return { ...rest, expand: expandRest };
}

describe('IngestBackfillService', () => {
  let service: IngestBackfillService;

  const taskMutator = {
    markSuccess: vi.fn(),
    markFailed: vi.fn(),
    getList: vi.fn(),
    createProcessUploadTask: vi.fn(),
  };
  const mediaMutator = { getList: vi.fn() };
  const filterFn = vi.fn((s: string, _params?: Record<string, unknown>) => s);
  const pb = {
    taskMutator,
    mediaMutator,
    updateTask: vi.fn(),
    getClient: vi.fn(() => ({ filter: filterFn })),
  };

  const backfillTask = {
    id: 'bf-1',
    type: TaskType.INGEST_BACKFILL,
    payload: {},
  } as unknown as Task;

  /** The IngestBackfillResult handed to markSuccess. */
  const reported = (): IngestBackfillResult =>
    taskMutator.markSuccess.mock.calls[0][1] as IngestBackfillResult;

  beforeEach(() => {
    vi.clearAllMocks();
    mediaMutator.getList.mockResolvedValue(emptyPage);
    taskMutator.getList.mockResolvedValue(emptyPage);
    taskMutator.createProcessUploadTask.mockResolvedValue({ id: 't-1' });
    taskMutator.markSuccess.mockResolvedValue(undefined);
    taskMutator.markFailed.mockResolvedValue(undefined);
    pb.updateTask.mockResolvedValue(undefined);

    service = new IngestBackfillService(pb as unknown as PocketBaseService);
  });

  it('claims the task before sweeping', async () => {
    await service.run(backfillTask);

    expect(pb.updateTask).toHaveBeenCalledWith('bf-1', {
      status: TaskStatus.RUNNING,
    });
  });

  it('queues nothing when every media is fully ingested', async () => {
    mediaMutator.getList.mockResolvedValueOnce(page([fullyIngestedVideo()]));

    await service.run(backfillTask);

    expect(taskMutator.createProcessUploadTask).not.toHaveBeenCalled();
    expect(reported()).toMatchObject({
      mediaScanned: 1,
      mediaNeedingWork: 0,
      tasksCreated: 0,
    });
  });

  it('queues only the missing step for a media without a waveform', async () => {
    mediaMutator.getList.mockResolvedValueOnce(page([videoMissingWaveform()]));

    await service.run(backfillTask);

    expect(taskMutator.createProcessUploadTask).toHaveBeenCalledTimes(1);
    const [workspaceId, userId, uploadId, payload] =
      taskMutator.createProcessUploadTask.mock.calls[0];
    expect(workspaceId).toBe('ws-1');
    expect(userId).toBe('user-1');
    expect(uploadId).toBe('up-1');
    expect(payload).toMatchObject({
      uploadId: 'up-1',
      mediaId: 'm-1',
      origin: 'backfill',
    });
    // Only the waveform config — nothing else is re-encoded.
    expect(payload.waveform).toBeDefined();
    expect(payload.thumbnail).toBeUndefined();
    expect(payload.sprite).toBeUndefined();
    expect(payload.filmstrip).toBeUndefined();
    expect(payload.transcode).toBeUndefined();
    expect(payload.audio).toBeUndefined();

    expect(reported()).toMatchObject({
      mediaNeedingWork: 1,
      tasksCreated: 1,
      stepCounts: { [TranscodeStepType.WAVEFORM]: 1 },
    });
  });

  it('queues a step whose stored asset predates the current ingest version', async () => {
    const media = fullyIngestedVideo();
    media.expand.proxyFileRef = {
      id: 'f-proxy',
      meta: {
        ingestVersion: INGEST_STEP_VERSIONS[TranscodeStepType.TRANSCODE] - 1,
      },
    };
    mediaMutator.getList.mockResolvedValueOnce(page([media]));

    await service.run(backfillTask);

    const payload = taskMutator.createProcessUploadTask.mock.calls[0][3];
    expect(payload.transcode).toMatchObject({ enabled: true });
    expect(payload.waveform).toBeUndefined();
  });

  it('leaves an unstamped legacy asset alone', async () => {
    const media = fullyIngestedVideo();
    // Written before ingest versioning existed: no `meta.ingestVersion`.
    media.expand.proxyFileRef = {
      id: 'f-proxy',
      meta: { mimeType: 'video/mp4' },
    } as unknown as { id: string; meta: { ingestVersion: number } };
    mediaMutator.getList.mockResolvedValueOnce(page([media]));

    await service.run(backfillTask);

    expect(taskMutator.createProcessUploadTask).not.toHaveBeenCalled();
  });

  it('skips a media whose transcode task is already in flight', async () => {
    mediaMutator.getList.mockResolvedValueOnce(page([videoMissingWaveform()]));
    taskMutator.getList.mockResolvedValueOnce(
      page([{ id: 't-old', status: TaskStatus.RUNNING }])
    );

    await service.run(backfillTask);

    expect(taskMutator.createProcessUploadTask).not.toHaveBeenCalled();
    expect(reported()).toMatchObject({ skippedInFlight: 1, tasksCreated: 0 });
  });

  it('abandons a media whose recent transcodes all failed', async () => {
    mediaMutator.getList.mockResolvedValueOnce(page([videoMissingWaveform()]));
    taskMutator.getList.mockResolvedValueOnce(
      page([
        { id: 't-3', status: TaskStatus.FAILED },
        { id: 't-2', status: TaskStatus.FAILED },
        { id: 't-1', status: TaskStatus.FAILED },
      ])
    );

    await service.run(backfillTask);

    expect(taskMutator.createProcessUploadTask).not.toHaveBeenCalled();
    expect(reported()).toMatchObject({ skippedFailing: 1 });
  });

  it('retries once a later success breaks the failure streak', async () => {
    mediaMutator.getList.mockResolvedValueOnce(page([videoMissingWaveform()]));
    taskMutator.getList.mockResolvedValueOnce(
      page([
        { id: 't-4', status: TaskStatus.SUCCESS },
        { id: 't-3', status: TaskStatus.FAILED },
        { id: 't-2', status: TaskStatus.FAILED },
        { id: 't-1', status: TaskStatus.FAILED },
      ])
    );

    await service.run(backfillTask);

    expect(taskMutator.createProcessUploadTask).toHaveBeenCalledTimes(1);
  });

  it('skips a media whose upload owner cannot be resolved', async () => {
    const media = videoMissingWaveform();
    media.expand = { ...media.expand, UploadRef: { id: 'up-1', UserRef: '' } };
    mediaMutator.getList.mockResolvedValueOnce(page([media]));

    await service.run(backfillTask);

    expect(taskMutator.createProcessUploadTask).not.toHaveBeenCalled();
    expect(reported()).toMatchObject({ skippedUnresolvable: 1 });
  });

  it('never asks a silent video for audio-derived assets', async () => {
    const media = videoMissingWaveform();
    mediaMutator.getList.mockResolvedValueOnce(
      page([{ ...media, hasAudio: false }])
    );

    await service.run(backfillTask);

    expect(taskMutator.createProcessUploadTask).not.toHaveBeenCalled();
    expect(reported()).toMatchObject({ mediaNeedingWork: 0 });
  });

  it('pages until a short page and counts every media scanned', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({
      ...fullyIngestedVideo(),
      id: `m-${i}`,
    }));
    mediaMutator.getList
      .mockResolvedValueOnce({ ...page(full), totalItems: 101 })
      .mockResolvedValueOnce({
        ...page([fullyIngestedVideo()]),
        totalItems: 101,
      });

    await service.run(backfillTask);

    expect(mediaMutator.getList).toHaveBeenCalledTimes(2);
    expect(reported().mediaScanned).toBe(101);
  });

  it('keeps sweeping when one media fails to queue', async () => {
    mediaMutator.getList.mockResolvedValueOnce(
      page([
        { ...videoMissingWaveform(), id: 'm-a' },
        { ...videoMissingWaveform(), id: 'm-b' },
      ])
    );
    taskMutator.createProcessUploadTask
      .mockRejectedValueOnce(new Error('pb down'))
      .mockResolvedValueOnce({ id: 't-2' });

    await service.run(backfillTask);

    expect(reported()).toMatchObject({ mediaNeedingWork: 2, tasksCreated: 1 });
    expect(taskMutator.markSuccess).toHaveBeenCalled();
  });

  it('marks the task failed when the sweep throws', async () => {
    mediaMutator.getList.mockRejectedValueOnce(new Error('pb exploded'));

    await service.run(backfillTask);

    expect(taskMutator.markFailed).toHaveBeenCalledWith(
      'bf-1',
      expect.stringContaining('pb exploded')
    );
    expect(taskMutator.markSuccess).not.toHaveBeenCalled();
  });
});
