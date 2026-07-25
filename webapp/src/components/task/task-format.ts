/**
 * Pure formatters shared by the task list rows and the task details page.
 */
import type { Task } from '@project/shared';
import { taskStatusValue } from './task-status-icon';

/** Compact absolute timestamp, dropping the year when it is the current one. */
export function formatTaskDateTime(dateString: string): string {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year:
      date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** Full timestamp for the details page. */
export function formatTaskTimestamp(dateString: string): string {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

/**
 * Elapsed wall-clock time: created → `updated` for finished tasks, created →
 * now for tasks still queued or running.
 */
export function formatTaskDuration(task: Task): string {
  const created = new Date(task.created);
  if (Number.isNaN(created.getTime())) return '—';

  const status = taskStatusValue(task.status);
  const finished =
    status === 'success' || status === 'failed' || status === 'canceled';
  const end = finished ? new Date(task.updated) : new Date();

  const seconds = Math.max(
    0,
    Math.floor((end.getTime() - created.getTime()) / 1000)
  );
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${days}d ${hours % 24}h`;
}

/** Pretty-print a payload/result object for the details page. */
export function formatTaskJSON(value: unknown): string {
  if (value === null || value === undefined) return 'N/A';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** `{ sourceType, sourceId }` rendered as a one-line label. */
export function formatTaskSource(task: Task): string {
  return `${task.sourceType}: ${task.sourceId}`;
}
