import { describe, it, expect, vi } from 'vitest';
import { TaskStatus, type Task } from '@project/shared';
import { buildProcessingMap } from '../use-processing-media';

vi.mock('@/lib/pocketbase-client', () => ({
  default: {
    collection: vi.fn(),
  },
}));

let taskCounter = 0;

function makeTask(overrides: Partial<Task>): Task {
  taskCounter += 1;
  return {
    id: `task${taskCounter}`,
    collectionId: 'tasks',
    collectionName: 'Tasks',
    expand: {},
    created: '2026-07-14 10:00:00.000Z',
    updated: '2026-07-14 10:00:00.000Z',
    sourceType: 'Media',
    sourceId: 'media1',
    type: 'process_upload',
    status: TaskStatus.QUEUED,
    progress: 1,
    attempts: 1,
    priority: 0,
    payload: {},
    WorkspaceRef: 'ws1',
    UserRef: 'user1',
    ...overrides,
  } as Task;
}

describe('buildProcessingMap', () => {
  it('shows the running task over a queued one, regardless of list order', () => {
    const transcode = makeTask({
      type: 'process_upload',
      status: TaskStatus.RUNNING,
    });
    const labels = makeTask({
      type: 'detect_labels',
      status: TaskStatus.QUEUED,
      created: '2026-07-14 10:00:01.000Z',
    });

    expect(buildProcessingMap([transcode, labels]).get('media1')).toBe(
      'Transcoding'
    );
    expect(buildProcessingMap([labels, transcode]).get('media1')).toBe(
      'Transcoding'
    );
  });

  it('shows the oldest task when several are queued together', () => {
    const transcode = makeTask({
      type: 'process_upload',
      status: TaskStatus.QUEUED,
      created: '2026-07-14 10:00:00.000Z',
    });
    const labels = makeTask({
      type: 'detect_labels',
      status: TaskStatus.QUEUED,
      created: '2026-07-14 10:00:01.000Z',
    });

    expect(buildProcessingMap([transcode, labels]).get('media1')).toBe(
      'Transcoding'
    );
    expect(buildProcessingMap([labels, transcode]).get('media1')).toBe(
      'Transcoding'
    );
  });

  it('shows the oldest running task when both are running', () => {
    const transcode = makeTask({
      type: 'process_upload',
      status: TaskStatus.RUNNING,
      created: '2026-07-14 10:00:00.000Z',
    });
    const labels = makeTask({
      type: 'detect_labels',
      status: TaskStatus.RUNNING,
      created: '2026-07-14 10:00:01.000Z',
    });

    expect(buildProcessingMap([labels, transcode]).get('media1')).toBe(
      'Transcoding'
    );
  });

  it('shows labeling once it is the only remaining task', () => {
    const labels = makeTask({
      type: 'detect_labels',
      status: TaskStatus.RUNNING,
    });

    expect(buildProcessingMap([labels]).get('media1')).toBe('Labeling');
  });

  it('tracks each media item independently', () => {
    const transcodeA = makeTask({
      sourceId: 'mediaA',
      type: 'process_upload',
      status: TaskStatus.RUNNING,
    });
    const labelsB = makeTask({
      sourceId: 'mediaB',
      type: 'detect_labels',
      status: TaskStatus.RUNNING,
    });

    const map = buildProcessingMap([transcodeA, labelsB]);
    expect(map.get('mediaA')).toBe('Transcoding');
    expect(map.get('mediaB')).toBe('Labeling');
  });

  it('resolves media id from upload task payloads', () => {
    const transcode = makeTask({
      sourceType: 'upload',
      sourceId: 'upload1',
      type: 'process_upload',
      status: TaskStatus.RUNNING,
      payload: { mediaId: 'media9' },
    });

    expect(buildProcessingMap([transcode]).get('media9')).toBe('Transcoding');
  });

  it('skips tasks with no resolvable media id', () => {
    const orphan = makeTask({ sourceType: 'upload', payload: {} });

    expect(buildProcessingMap([orphan]).size).toBe(0);
  });
});
