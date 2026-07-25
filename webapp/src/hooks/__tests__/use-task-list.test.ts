/**
 * Pure-function coverage for the task live list: the client-side filter
 * mirror (buildTaskMatches) and the sort descriptors whose comparators must
 * mirror their PocketBase sort strings with a total tiebreak.
 */
import { describe, it, expect } from 'vitest';
import type { Task } from '@project/shared';
import { buildTaskMatches } from '../use-task-list';
import {
  TASK_SORT_OPTIONS,
  getTaskSortOption,
  DEFAULT_TASK_SORT,
} from '@/components/task/task-sort';

const T0 = '2026-07-18 10:00:00.000Z';
const T1 = '2026-07-18 10:00:01.000Z';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    WorkspaceRef: 'ws-1',
    UserRef: 'user-1',
    sourceType: 'Media',
    sourceId: 'media-1',
    type: 'detect_labels',
    status: 'queued',
    progress: 1,
    attempts: 1,
    priority: 0,
    payload: {},
    errorLog: '',
    created: T0,
    updated: T0,
    ...overrides,
  } as unknown as Task;
}

describe('buildTaskMatches', () => {
  const base = {
    workspaceId: 'ws-1',
    status: 'all',
    type: 'all',
    search: '',
  };

  it('requires the workspace to match', () => {
    const matches = buildTaskMatches(base);
    expect(matches(makeTask())).toBe(true);
    expect(matches(makeTask({ WorkspaceRef: 'ws-2' }))).toBe(false);
  });

  it('filters by a single status', () => {
    const matches = buildTaskMatches({ ...base, status: 'failed' });
    expect(matches(makeTask({ status: 'failed' } as never))).toBe(true);
    expect(matches(makeTask({ status: 'success' } as never))).toBe(false);
  });

  it("treats 'active' as queued or running", () => {
    const matches = buildTaskMatches({ ...base, status: 'active' });
    expect(matches(makeTask({ status: 'queued' } as never))).toBe(true);
    expect(matches(makeTask({ status: 'running' } as never))).toBe(true);
    expect(matches(makeTask({ status: 'success' } as never))).toBe(false);
    expect(matches(makeTask({ status: 'canceled' } as never))).toBe(false);
  });

  it('accepts a select field that arrives as an array', () => {
    const matches = buildTaskMatches({ ...base, status: 'running' });
    expect(matches(makeTask({ status: ['running'] } as never))).toBe(true);
  });

  it('filters by task type', () => {
    const matches = buildTaskMatches({ ...base, type: 'render_timeline' });
    expect(matches(makeTask({ type: 'render_timeline' }))).toBe(true);
    expect(matches(makeTask({ type: 'detect_labels' }))).toBe(false);
  });

  it('searches id, type, sourceId, and errorLog case-insensitively', () => {
    const matches = buildTaskMatches({ ...base, search: 'FFMPEG' });
    expect(matches(makeTask({ errorLog: 'ffmpeg exited with code 1' }))).toBe(
      true
    );
    expect(matches(makeTask())).toBe(false);

    const bySource = buildTaskMatches({ ...base, search: 'media-1' });
    expect(bySource(makeTask())).toBe(true);

    const byId = buildTaskMatches({ ...base, search: 't1' });
    expect(byId(makeTask())).toBe(true);

    const byType = buildTaskMatches({ ...base, search: 'labels' });
    expect(byType(makeTask())).toBe(true);
  });

  it('treats whitespace-only search as no search', () => {
    const matches = buildTaskMatches({ ...base, search: '   ' });
    expect(matches(makeTask())).toBe(true);
  });
});

describe('TASK_SORT_OPTIONS', () => {
  const byValue = (value: string) => getTaskSortOption(value);

  it('falls back to the default sort for unknown values', () => {
    expect(getTaskSortOption('bogus').value).toBe(DEFAULT_TASK_SORT);
    expect(getTaskSortOption(null).value).toBe(DEFAULT_TASK_SORT);
  });

  it('never compares distinct records equal (total tiebreak)', () => {
    // Identical on every sort key except id.
    const a = makeTask({ id: 'aaa' });
    const b = makeTask({ id: 'bbb' });
    for (const option of TASK_SORT_OPTIONS) {
      expect(option.compare(a, b)).not.toBe(0);
      expect(Math.sign(option.compare(a, b))).toBe(
        -Math.sign(option.compare(b, a))
      );
    }
  });

  it('recent sorts newest first, oldest sorts the reverse', () => {
    const newer = makeTask({ id: 'n', created: T1 });
    const older = makeTask({ id: 'o', created: T0 });
    expect(byValue('recent').compare(newer, older)).toBeLessThan(0);
    expect(byValue('recent').pbSort).toBe('-created');
    expect(byValue('oldest').compare(newer, older)).toBeGreaterThan(0);
    expect(byValue('oldest').pbSort).toBe('created');
  });

  it('updated sorts most recently touched first, then recency', () => {
    const option = byValue('updated');
    const touched = makeTask({ id: 'a', updated: T1 });
    const stale = makeTask({ id: 'b', updated: T0 });
    expect(option.compare(touched, stale)).toBeLessThan(0);

    const sameUpdate = makeTask({ id: 'c', updated: T1, created: T1 });
    expect(option.compare(sameUpdate, touched)).toBeLessThan(0);
  });

  it('status and type sort ascending, falling back to recency', () => {
    const canceled = makeTask({ id: 'a', status: 'canceled' } as never);
    const running = makeTask({ id: 'b', status: 'running' } as never);
    expect(byValue('status').compare(canceled, running)).toBeLessThan(0);

    const detect = makeTask({ id: 'c', type: 'detect_labels' });
    const render = makeTask({ id: 'd', type: 'render_timeline' });
    expect(byValue('type').compare(detect, render)).toBeLessThan(0);

    const newerRender = makeTask({
      id: 'e',
      type: 'render_timeline',
      created: T1,
    });
    expect(byValue('type').compare(newerRender, render)).toBeLessThan(0);
  });
});
