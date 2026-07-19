import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { TaskInputSchema, type Task, type TaskInput } from '../schema';
import {
  type ProcessUploadPayload,
  type RenderTimelinePayload,
  type DetectLabelsPayload,
} from '../types';
import { ProcessingProvider, TaskStatus, TaskType } from '../enums';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';

// Providers the Tasks record's `provider` select field accepts. The
// payload-level ProcessingProvider enum is wider (e.g. `elevenlabs` only ever
// appears at step level), so unknown values are dropped rather than failing
// task creation.
const TASK_RECORD_PROVIDERS: ReadonlySet<string> = new Set([
  ProcessingProvider.FFMPEG,
  ProcessingProvider.GOOGLE_TRANSCODER,
  ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
  ProcessingProvider.GOOGLE_SPEECH,
]);

/**
 * Narrow a payload provider to one storable on the Task record. The record's
 * `provider` field drives the hung-task watchdog cron's provider-keyed
 * staleness thresholds (pb/pb_hooks/cron-tasks-watchdog.pb.js), so tasks
 * should carry it from creation — a payload-only provider is invisible to
 * the cron.
 */
export function asTaskRecordProvider(
  provider: string | undefined
): TaskInput['provider'] {
  return provider && TASK_RECORD_PROVIDERS.has(provider)
    ? (provider as TaskInput['provider'])
    : undefined;
}

export class TaskMutator extends BaseMutator<Task, TaskInput> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<Task> {
    return this.pb.collection('Tasks');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: ['WorkspaceRef', 'UserRef'],
      filter: [],
      sort: ['-created'],
    };
  }

  protected async validateInput(input: TaskInput): Promise<TaskInput> {
    return TaskInputSchema.parse(input);
  }

  /**
   * Create a process upload task
   * @param workspaceId The workspace ID
   * @param userId The user ID
   * @param uploadId The upload ID
   * @param payload The task payload
   * @returns The created task
   */
  async createProcessUploadTask(
    workspaceId: string,
    userId: string,
    uploadId: string,
    payload: ProcessUploadPayload
  ): Promise<Task> {
    return this.create({
      sourceType: 'upload',
      sourceId: uploadId,
      type: TaskType.PROCESS_UPLOAD,
      status: TaskStatus.QUEUED,
      progress: 1,
      attempts: 1,
      payload: payload as unknown as Record<string, unknown>,
      WorkspaceRef: workspaceId,
      UserRef: userId,
      // Transcode flows run ffmpeg steps unless the payload says otherwise.
      provider:
        asTaskRecordProvider(payload.provider) ?? ProcessingProvider.FFMPEG,
    });
  }

  /**
   * Create a render timeline task
   * @param workspaceId The workspace ID
   * @param userId The user ID
   * @param timelineId The timeline ID
   * @param payload The task payload
   * @returns The created task
   */
  async createRenderTimelineTask(
    workspaceId: string,
    userId: string,
    timelineId: string,
    payload: RenderTimelinePayload
  ): Promise<Task> {
    return this.create({
      sourceType: 'Timeline',
      sourceId: timelineId,
      type: TaskType.RENDER_TIMELINE,
      status: TaskStatus.QUEUED,
      progress: 1,
      attempts: 1,
      payload: payload as unknown as Record<string, unknown>,
      WorkspaceRef: workspaceId,
      UserRef: userId,
      // Render flows are ffmpeg-backed unless the payload says otherwise.
      provider:
        asTaskRecordProvider(payload.provider) ?? ProcessingProvider.FFMPEG,
    });
  }

  /**
   * Create a detect labels task
   * @param workspaceId The workspace ID
   * @param userId The user ID
   * @param mediaId The media ID
   * @param payload The task payload
   * @returns The created task
   */
  async createDetectLabelsTask(
    workspaceId: string,
    userId: string,
    mediaId: string,
    payload: DetectLabelsPayload
  ): Promise<Task> {
    return this.create({
      sourceType: 'Media',
      sourceId: mediaId,
      type: TaskType.DETECT_LABELS,
      status: TaskStatus.QUEUED,
      progress: 1,
      attempts: 1,
      payload: payload as unknown as Record<string, unknown>,
      WorkspaceRef: workspaceId,
      UserRef: userId,
      provider: asTaskRecordProvider(payload.provider),
    });
  }

  /**
   * Get tasks by source ID (media ID, upload ID, or timeline ID)
   * @param sourceId The source entity ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   * @returns List of tasks for the source
   */
  async getBySourceId(
    sourceId: string,
    page = 1,
    perPage = 100
  ): Promise<ListResult<Task>> {
    return this.getList(page, perPage, `sourceId = "${sourceId}"`);
  }

  /**
   * Update task progress
   * @param id The task ID
   * @param progress The progress percentage (0-100)
   * @returns The updated task
   */
  async updateProgress(id: string, progress: number): Promise<Task> {
    return this.update(id, { progress } as Partial<Task>);
  }

  /**
   * Mark task as successful
   * @param id The task ID
   * @param result The task result
   * @returns The updated task
   */
  async markSuccess(
    id: string,
    result: Record<string, unknown>
  ): Promise<Task> {
    return this.update(id, {
      status: TaskStatus.SUCCESS,
      progress: 100,
      result: result as unknown as Record<string, unknown>,
    } as Partial<Task>);
  }

  /**
   * Mark task as failed
   * @param id The task ID
   * @param errorLog The error message
   * @returns The updated task
   */
  async markFailed(id: string, errorLog: string): Promise<Task> {
    const task = await this.getById(id);
    // Truncate errorLog to 500 characters to ensure it fits in the database field
    const truncatedErrorLog =
      errorLog.length > 500 ? errorLog.substring(0, 497) + '...' : errorLog;
    return this.update(id, {
      status: TaskStatus.FAILED,
      errorLog: truncatedErrorLog,
      attempts: (task?.attempts || 0) + 1,
    } as Partial<Task>);
  }

  /**
   * Get queued tasks
   * @param type Optional task type filter
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   * @returns List of queued tasks
   */
  async getQueuedTasks(
    type?: TaskType,
    page = 1,
    perPage = 100
  ): Promise<ListResult<Task>> {
    const filter = type
      ? this.pb.filter('status = {:status} && type = {:type}', {
          status: TaskStatus.QUEUED,
          type,
        })
      : this.pb.filter('status = {:status}', { status: TaskStatus.QUEUED });
    return this.getList(page, perPage, filter, 'created');
  }

  /**
   * Retry a task
   * @param id The task ID
   * @returns The updated task
   */
  async retry(id: string): Promise<Task> {
    return this.update(id, {
      status: TaskStatus.QUEUED,
      progress: 1, // Avoid 0 as it might be interpreted as blank by PocketBase
      attempts: 1, // Reset to 1 (first attempt of the retry)
      errorLog: '',
      result: {},
    } as Partial<Task>);
  }
}
