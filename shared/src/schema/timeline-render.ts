import {
  defineCollection,
  NumberField,
  RelationField,
  TextField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';

// Define the Zod schema
export const TimelineRenderSchema = z
  .object({
    TimelineRef: RelationField({ collection: 'Timelines' }),
    FileRef: RelationField({ collection: 'Files' }),
    version: NumberField().default(1).optional(), // Version of the timeline when rendered
    processor: TextField().optional(),
  })
  .extend(baseSchema);

// Define input schema for creating timeline renders
export const TimelineRenderInputSchema = z.object({
  TimelineRef: z.string().min(1, 'Timeline is required'),
  FileRef: z.string().min(1, 'File is required'),
  version: NumberField().default(1).optional(),
});

// Define the collection with workspace-scoped permissions
export const TimelineRenderCollection = defineCollection({
  collectionName: 'TimelineRenders',
  schema: TimelineRenderSchema,
  permissions: {
    // Authenticated users can list timeline renders
    listRule: '@request.auth.id != ""',
    // Authenticated users can view timeline renders
    viewRule: '@request.auth.id != ""',
    // Authenticated users can create timeline renders
    createRule: '@request.auth.id != ""',
    // Authenticated users can update timeline renders
    updateRule: '@request.auth.id != ""',
    // Authenticated users can delete timeline renders
    deleteRule: '@request.auth.id != ""',
  },
});

export default TimelineRenderCollection;

// Export TypeScript types
export type TimelineRender = z.infer<typeof TimelineRenderSchema>;
export type TimelineRenderInput = z.infer<typeof TimelineRenderInputSchema>;
export type TimelineRenderUpdate = Partial<TimelineRenderInput>;
