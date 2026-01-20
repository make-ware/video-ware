import {
  defineCollection,
  TextField,
  NumberField,
  SelectField,
  RelationField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
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
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    UserRef: RelationField({ collection: 'Users' }),
    provider: SelectField([
      ProcessingProvider.FFMPEG,
      ProcessingProvider.GOOGLE_TRANSCODER,
      ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
      ProcessingProvider.GOOGLE_SPEECH,
    ]).optional(),
    version: TextField().optional(),
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
    TaskType.GENERATE_TIMELINE_RECOMMENDATIONS,
    TaskType.GENERATE_MEDIA_RECOMMENDATIONS,
    TaskType.RENDER_TIMELINE,
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
  permissions: {
    // Authenticated users can list tasks
    listRule: '@request.auth.id != ""',
    // Authenticated users can view tasks
    viewRule: '@request.auth.id != ""',
    // Authenticated users can create tasks
    createRule: '@request.auth.id != ""',
    // Authenticated users can update tasks
    updateRule: '@request.auth.id != ""',
    // Authenticated users can delete tasks
    deleteRule: '@request.auth.id != ""',
  },
});

export default TaskCollection;

// Export TypeScript types
export type Task = z.infer<typeof TaskSchema>;
export type TaskInput = z.infer<typeof TaskInputSchema>;
export type TaskUpdate = Partial<TaskInput>;
