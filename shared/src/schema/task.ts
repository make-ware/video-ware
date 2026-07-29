import {
  defineCollection,
  TextField,
  NumberField,
  SelectField,
  RelationField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema';
import { workspaceScopedPermissions } from '../utils/collection-permissions';
import { z } from 'zod';
import { TaskStatus, TaskType, ProcessingProvider } from '../enums';
import { TaskPayloadSchema, TaskResultSchema } from '../types/metadata';

// Define the Zod schema
export const TaskSchema = z
  .object({
    sourceType: TextField(),
    sourceId: TextField(),
    type: TextField(),
    status: SelectField([
      TaskStatus.QUEUED,
      TaskStatus.RUNNING,
      TaskStatus.SUCCESS,
      TaskStatus.FAILED,
      TaskStatus.CANCELED,
    ]),
    progress: NumberField({ min: 0, max: 100 }).default(1),
    attempts: NumberField({ min: 0 }).default(1),
    priority: NumberField().default(0),
    payload: JSONField(TaskPayloadSchema),
    result: JSONField(TaskResultSchema).optional(),
    errorLog: TextField().optional(),
    // Optional at the DB level (1781800001 migration): system tasks (the
    // `cleanup` task) are created without these by the storageCleanup PB cron.
    // Code paths that only ever see user-facing tasks (the worker flow
    // builders) take `WorkspaceTask` instead, narrowed via `isWorkspaceTask`.
    WorkspaceRef: RelationField({ collection: 'Workspaces' }).optional(),
    UserRef: RelationField({ collection: 'Users' }).optional(),
    provider: SelectField([
      ProcessingProvider.FFMPEG,
      ProcessingProvider.GOOGLE_TRANSCODER,
      ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
      ProcessingProvider.GOOGLE_SPEECH,
    ]).optional(),
    version: TextField().optional(),
    // Set by the worker when a BullMQ job claims this task (the `active`
    // event). Lets the hung-task watchdog cron and manual debugging trace a
    // stuck Task back to its actual job in Bull Board/Redis.
    bullJobId: TextField().optional(),
    queueName: TextField().optional(),
  })
  .extend(baseSchema);

// Define input schema for creating tasks
export const TaskInputSchema = z.object({
  sourceType: TextField(),
  sourceId: TextField(),
  type: z.enum([
    TaskType.PROCESS_UPLOAD,
    TaskType.DERIVE_CLIPS,
    TaskType.DETECT_LABELS,
    TaskType.RENDER_TIMELINE,
    TaskType.CLEANUP,
  ]),
  status: z
    .enum([
      TaskStatus.QUEUED,
      TaskStatus.RUNNING,
      TaskStatus.SUCCESS,
      TaskStatus.FAILED,
      TaskStatus.CANCELED,
    ])
    .default(TaskStatus.QUEUED),
  progress: NumberField({ min: 0, max: 100 }).default(1).optional(),
  attempts: NumberField({ min: 0 }).default(1).optional(),
  priority: NumberField().default(0).optional(),
  payload: TaskPayloadSchema,
  result: TaskResultSchema.optional(),
  errorLog: TextField().optional(),
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  UserRef: z.string().min(1, 'User is required'),
  provider: z
    .enum([
      ProcessingProvider.FFMPEG,
      ProcessingProvider.GOOGLE_TRANSCODER,
      ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
      ProcessingProvider.GOOGLE_SPEECH,
    ])
    .optional(),
  version: TextField().optional(),
});

// Define the collection with workspace-scoped permissions
export const TaskCollection = defineCollection({
  collectionName: 'Tasks',
  schema: TaskSchema,
  permissions: workspaceScopedPermissions(),
});

export default TaskCollection;

// Export TypeScript types
export type Task = z.infer<typeof TaskSchema>;
export type TaskInput = z.infer<typeof TaskInputSchema>;
export type TaskUpdate = Partial<TaskInput>;

// A user-facing task: every task except system tasks (`cleanup`) carries
// workspace + user context. The worker flow builders take this type so they
// can treat WorkspaceRef as a present string.
export type WorkspaceTask = Task & {
  WorkspaceRef: string;
  UserRef: string;
};

// PocketBase returns '' (not undefined) for an unset single relation, so
// presence must be a truthiness check, never `!== undefined`.
export function isWorkspaceTask(task: Task): task is WorkspaceTask {
  return !!task.WorkspaceRef && !!task.UserRef;
}
