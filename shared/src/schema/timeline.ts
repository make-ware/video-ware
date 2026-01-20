import {
  defineCollection,
  TextField,
  NumberField,
  RelationField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';
import { TimelineMetadataSchema } from '../types/metadata';

// Zod schema for EditListEntry validation (types are in types/video-ware.ts)
export const TimeOffsetSchema = z.object({
  seconds: z.number().int().min(0),
  nanos: z.number().int().min(0).max(999999999),
});

// Define the Zod schema
export const TimelineSchema = z
  .object({
    name: TextField().min(1).max(200),
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    duration: NumberField({ min: 0 }).default(0), // computed total duration in seconds
    timelineData: JSONField(TimelineMetadataSchema).optional(),
    UserRef: RelationField({ collection: 'Users' }).optional(),
    version: NumberField().default(1).optional(),
    processor: TextField().optional(),
  })
  .extend(baseSchema);

// Define input schema for creating timelines
export const TimelineInputSchema = z.object({
  name: z.string().min(1).max(200),
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  duration: z.number().min(0).default(0),
  timelineData: TimelineMetadataSchema.optional(),
  UserRef: z.string().optional(),
  version: z.number().default(1).optional(),
  processor: z.string().optional(),
});

// Define the collection with workspace-scoped permissions
export const TimelineCollection = defineCollection({
  collectionName: 'Timelines',
  schema: TimelineSchema,
  permissions: {
    // Authenticated users can list timelines
    listRule: '@request.auth.id != ""',
    // Authenticated users can view timelines
    viewRule: '@request.auth.id != ""',
    // Authenticated users can create timelines
    createRule: '@request.auth.id != ""',
    // Authenticated users can update timelines
    updateRule: '@request.auth.id != ""',
    // Authenticated users can delete timelines
    deleteRule: '@request.auth.id != ""',
  },
});

export default TimelineCollection;

// Export TypeScript types
export type Timeline = z.infer<typeof TimelineSchema>;
export type TimelineInput = z.infer<typeof TimelineInputSchema>;
export type TimelineUpdate = Partial<TimelineInput>;
