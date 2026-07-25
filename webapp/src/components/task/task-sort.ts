/**
 * Sort descriptors for the task list: each option pairs the PocketBase sort
 * string sent to the server with a client-side comparator that mirrors it, so
 * realtime merges can position SSE records inside the loaded window (see
 * utils/live-list.ts).
 *
 * Every comparator embeds a total tiebreak (created, then id) so distinct
 * records never compare equal — live-list relies on 0 meaning "same record,
 * sort key unchanged". Client comparators approximate server collation (e.g.
 * localeCompare vs SQLite BINARY on status/type); refetches true up any
 * divergence.
 */
import type { Task } from '@project/shared';

export type TaskSortValue = 'recent' | 'oldest' | 'updated' | 'status' | 'type';

export interface TaskSortOption {
  value: TaskSortValue;
  label: string;
  /** PocketBase sort string (server-side ordering). */
  pbSort: string;
  /** Client mirror of pbSort, total-ordered via created/id tiebreak. */
  compare: (a: Task, b: Task) => number;
}

export const DEFAULT_TASK_SORT: TaskSortValue = 'recent';

/** id asc — the final tiebreak shared by every comparator. */
function byId(a: Task, b: Task): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** created desc, then id asc. */
function byRecency(a: Task, b: Task): number {
  if (a.created !== b.created) return a.created < b.created ? 1 : -1;
  return byId(a, b);
}

/** created asc, then id asc. */
function byAge(a: Task, b: Task): number {
  if (a.created !== b.created) return a.created < b.created ? -1 : 1;
  return byId(a, b);
}

/** A select field can surface as a single-element array; normalize it. */
function scalar(value: string | string[]): string {
  return Array.isArray(value) ? (value[0] ?? '') : value;
}

export const TASK_SORT_OPTIONS: readonly TaskSortOption[] = [
  {
    value: 'recent',
    label: 'Newest',
    pbSort: '-created',
    compare: byRecency,
  },
  {
    value: 'oldest',
    label: 'Oldest',
    pbSort: 'created',
    compare: byAge,
  },
  {
    value: 'updated',
    label: 'Last Updated',
    pbSort: '-updated,-created',
    compare: (a, b) => {
      const updatedA = a.updated ?? '';
      const updatedB = b.updated ?? '';
      if (updatedA !== updatedB) return updatedA < updatedB ? 1 : -1;
      return byRecency(a, b);
    },
  },
  {
    value: 'status',
    label: 'Status',
    pbSort: 'status,-created',
    compare: (a, b) => {
      const byStatus = scalar(a.status).localeCompare(scalar(b.status));
      if (byStatus !== 0) return byStatus;
      return byRecency(a, b);
    },
  },
  {
    value: 'type',
    label: 'Type',
    pbSort: 'type,-created',
    compare: (a, b) => {
      const byType = scalar(a.type).localeCompare(scalar(b.type));
      if (byType !== 0) return byType;
      return byRecency(a, b);
    },
  },
];

/** Resolve a (URL-sourced) sort value, falling back to the default. */
export function getTaskSortOption(value: string | null): TaskSortOption {
  return (
    TASK_SORT_OPTIONS.find((option) => option.value === value) ??
    TASK_SORT_OPTIONS[0]
  );
}
