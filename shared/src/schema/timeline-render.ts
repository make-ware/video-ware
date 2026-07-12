import {
  defineCollection,
  NumberField,
  RelationField,
  SelectField,
  TextField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { workspaceScopedPermissions } from '../utils/collection-permissions';
import { z } from 'zod';
import { TaskStatus } from '../enums';
import {
  TimelineMetadataSchema,
  RenderTimelineConfigSchema,
} from '../types/metadata';

// Define the Zod schema
export const TimelineRenderSchema = z
  .object({
    TimelineRef: RelationField({ collection: 'Timelines' }),
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    UserRef: RelationField({ collection: 'Users' }).optional(),
    // Output file — set by the worker once the render finishes (empty while
    // the render is queued/running).
    FileRef: RelationField({ collection: 'Files' }).optional(),
    version: NumberField().default(1).optional(), // Version of the timeline when rendered
    // Render input captured at creation time. The worker reads these to run the
    // render in the background — the client never builds a task payload.
    timelineData: JSONField(TimelineMetadataSchema).optional(),
    outputSettings: JSONField(RenderTimelineConfigSchema).optional(),
    // Lifecycle — the entity is the source of truth for render progress.
    status: SelectField([
      TaskStatus.QUEUED,
      TaskStatus.RUNNING,
      TaskStatus.SUCCESS,
      TaskStatus.FAILED,
      TaskStatus.CANCELED,
    ]).optional(),
    progress: NumberField({ min: 0, max: 100 }).default(1).optional(),
    errorLog: TextField().optional(),
    processor: TextField().optional(),
  })
  .extend(baseSchema);

// Define input schema for creating timeline renders
export const TimelineRenderInputSchema = z.object({
  TimelineRef: z.string().min(1, 'Timeline is required'),
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  UserRef: z.string().optional(),
  FileRef: z.string().optional(),
  version: NumberField().default(1).optional(),
  timelineData: TimelineMetadataSchema.optional(),
  outputSettings: RenderTimelineConfigSchema.optional(),
  status: z
    .enum([
      TaskStatus.QUEUED,
      TaskStatus.RUNNING,
      TaskStatus.SUCCESS,
      TaskStatus.FAILED,
      TaskStatus.CANCELED,
    ])
    .default(TaskStatus.QUEUED)
    .optional(),
  progress: NumberField({ min: 0, max: 100 }).default(1).optional(),
  errorLog: z.string().optional(),
});

// Define the collection with workspace-scoped permissions
export const TimelineRenderCollection = defineCollection({
  collectionName: 'TimelineRenders',
  schema: TimelineRenderSchema,
  permissions: workspaceScopedPermissions(),
});

export default TimelineRenderCollection;

// Export TypeScript types
export type TimelineRender = z.infer<typeof TimelineRenderSchema>;
export type TimelineRenderInput = z.infer<typeof TimelineRenderInputSchema>;
export type TimelineRenderUpdate = Partial<TimelineRenderInput>;
