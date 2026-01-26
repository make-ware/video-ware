import {
  defineCollection,
  TextField,
  NumberField,
  RelationField,
  BoolField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';

// Define the Zod schema
export const TimelineTrackSchema = z
  .object({
    TimelineRef: RelationField({ collection: 'Timelines' }),
    name: TextField().min(1).max(200).optional(),
    layer: NumberField({ min: 0 }).default(0), // visual layer index (0 is bottom)
    volume: NumberField({ min: 0, max: 1 }).default(1), // 0.0 to 1.0
    opacity: NumberField({ min: 0, max: 1 }).default(1), // 0.0 to 1.0
    isMuted: BoolField().default(false),
    isLocked: BoolField().default(false),
  })
  .extend(baseSchema);

// Define input schema for creating timeline tracks
export const TimelineTrackInputSchema = z.object({
  TimelineRef: z.string().min(1, 'Timeline is required'),
  name: z.string().min(1).max(200).optional(),
  layer: z.number().min(0).default(0).optional(),
  volume: z.number().min(0).max(1).default(1).optional(),
  opacity: z.number().min(0).max(1).default(1).optional(),
  isMuted: z.boolean().default(false).optional(),
  isLocked: z.boolean().default(false).optional(),
});

// Define the collection with workspace-scoped permissions
export const TimelineTrackCollection = defineCollection({
  collectionName: 'TimelineTracks',
  schema: TimelineTrackSchema,
  permissions: {
    // Authenticated users can list timeline tracks
    listRule: '@request.auth.id != ""',
    // Authenticated users can view timeline tracks
    viewRule: '@request.auth.id != ""',
    // Authenticated users can create timeline tracks
    createRule: '@request.auth.id != ""',
    // Authenticated users can update timeline tracks
    updateRule: '@request.auth.id != ""',
    // Authenticated users can delete timeline tracks
    deleteRule: '@request.auth.id != ""',
  },
});

export default TimelineTrackCollection;

// Export TypeScript types
export type TimelineTrackRecord = z.infer<typeof TimelineTrackSchema>;
export type TimelineTrackRecordInput = z.infer<typeof TimelineTrackInputSchema>;
export type TimelineTrackRecordUpdate = Partial<TimelineTrackRecordInput>;
