import type { TypedPocketBase } from '@project/shared/types';
import { TaskMutator } from '@project/shared/mutator';
import { TaskStatus, type Task } from '@project/shared';
import type { ListResult } from 'pocketbase';

/** Statuses meaning "not finished yet" — the `active` status filter value. */
export const ACTIVE_TASK_STATUSES: readonly string[] = [
  TaskStatus.QUEUED,
  TaskStatus.RUNNING,
];

/** Server-side filters for `TaskService.listTasks`. */
export interface TaskListQuery {
  workspaceId: string;
  /** 'all'/undefined = every status; 'active' = queued or running. */
  status?: string;
  /** 'all'/undefined = every type. */
  type?: string;
  /** Matched against id, type, sourceId, and errorLog. */
  search?: string;
}

/**
 * Task service: workspace-scoped task listing with the pagination envelope
 * preserved, plus the retry/cancel lifecycle writes. Deliberately expand-free
 * — nothing the task UI renders lives on a relation, so realtime records can
 * be merged into the list cache exactly as they arrive (no enrichment step).
 */
export class TaskService {
  private pb: TypedPocketBase;
  private taskMutator: TaskMutator;

  constructor(pb: TypedPocketBase) {
    this.pb = pb;
    this.taskMutator = new TaskMutator(pb);
  }

  /**
   * List tasks with server-side filters and sort. User input is bound via
   * pb.filter — never interpolated into the filter string.
   */
  async listTasks(
    query: TaskListQuery,
    page = 1,
    perPage = 25,
    sort = '-created'
  ): Promise<ListResult<Task>> {
    const clauses = [
      this.pb.filter('WorkspaceRef = {:ws}', { ws: query.workspaceId }),
    ];

    if (query.status === 'active') {
      clauses.push(
        this.pb.filter('(status = {:queued} || status = {:running})', {
          queued: TaskStatus.QUEUED,
          running: TaskStatus.RUNNING,
        })
      );
    } else if (query.status && query.status !== 'all') {
      clauses.push(
        this.pb.filter('status = {:status}', { status: query.status })
      );
    }

    if (query.type && query.type !== 'all') {
      clauses.push(this.pb.filter('type = {:type}', { type: query.type }));
    }

    const search = query.search?.trim();
    if (search) {
      clauses.push(
        this.pb.filter(
          '(id ~ {:q} || type ~ {:q} || sourceId ~ {:q} || errorLog ~ {:q})',
          { q: search }
        )
      );
    }

    return this.taskMutator.getList(page, perPage, clauses, sort);
  }

  /** Fetch one task, or null when it does not exist / is not readable. */
  async getTaskById(taskId: string): Promise<Task | null> {
    return this.taskMutator.getById(taskId);
  }

  /** Requeue a failed or canceled task (resets progress, attempts, error). */
  async retryTask(taskId: string): Promise<Task> {
    return this.taskMutator.retry(taskId);
  }

  /** Cancel a queued or running task. */
  async cancelTask(taskId: string): Promise<Task> {
    return this.taskMutator.update(taskId, {
      status: TaskStatus.CANCELED,
    } as Partial<Task>);
  }
}

export function createTaskService(pb: TypedPocketBase): TaskService {
  return new TaskService(pb);
}
