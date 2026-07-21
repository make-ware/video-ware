import {
  defineCollection,
  TextField,
  NumberField,
  RelationField,
  SingleSelectField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { workspaceScopedPermissions } from '../utils/collection-permissions';
import { z } from 'zod';
import { TimelineOrientation } from '../enums';

// Define the Zod schema
export const TimelineSchema = z
  .object({
    name: TextField().min(1).max(200),
    label: TextField().optional(), // editor-facing name, searchable
    description: TextField().optional(), // editor-facing notes, searchable
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    duration: NumberField({ min: 0 }).default(0), // computed total duration in seconds
    UserRef: RelationField({ collection: 'Users' }).optional(),
    version: NumberField().default(1).optional(),
    processor: TextField().optional(),
    orientation: SingleSelectField([
      TimelineOrientation.LANDSCAPE,
      TimelineOrientation.PORTRAIT,
    ]).optional(),
  })
  .extend(baseSchema);

// Define input schema for creating timelines
export const TimelineInputSchema = z.object({
  name: z.string().min(1).max(200),
  label: z.string().optional(),
  description: z.string().optional(),
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  duration: z.number().min(0).default(0),
  UserRef: z.string().optional(),
  version: z.number().default(1).optional(),
  processor: z.string().optional(),
  orientation: z
    .enum([TimelineOrientation.LANDSCAPE, TimelineOrientation.PORTRAIT])
    .default(TimelineOrientation.LANDSCAPE)
    .optional(),
});

// Define the collection with workspace-scoped permissions
export const TimelineCollection = defineCollection({
  collectionName: 'Timelines',
  schema: TimelineSchema,
  permissions: workspaceScopedPermissions(),
});

export default TimelineCollection;

// Export TypeScript types
export type Timeline = z.infer<typeof TimelineSchema>;
export type TimelineInput = z.infer<typeof TimelineInputSchema>;
export type TimelineUpdate = Partial<TimelineInput>;
