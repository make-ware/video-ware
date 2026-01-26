import {
  defineCollection,
  NumberField,
  RelationField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';
import { TimelineClipMetadataSchema } from '../types/metadata';

// Define the Zod schema
export const TimelineClipSchema = z
  .object({
    TimelineRef: RelationField({ collection: 'Timelines' }),
    TimelineTrackRef: RelationField({
      collection: 'TimelineTracks',
    }).optional(),
    MediaRef: RelationField({ collection: 'Media' }),
    MediaClipRef: RelationField({ collection: 'MediaClips' }).optional(),
    order: NumberField({ min: 0 }), // position in timeline sequence
    start: NumberField({ min: 0 }).default(0), // absolute start time in source media (seconds)
    end: NumberField({ min: 0 }).default(0), // absolute end time in source media (seconds)
    timelineStart: NumberField({ min: 0 }).optional(), // absolute start time on timeline (seconds), if set overrides sequential placement
    duration: NumberField({ min: 0 }).default(0), // computed as end - start (seconds)
    meta: JSONField(TimelineClipMetadataSchema).optional(), // title, color, transitions, effects
  })
  .extend(baseSchema);

// Define input schema for creating timeline clips
export const TimelineClipInputSchema = z.object({
  TimelineRef: z.string().min(1, 'Timeline is required'),
  TimelineTrackRef: z.string().optional(),
  MediaRef: z.string().min(1, 'Media is required'),
  MediaClipRef: z.string().optional(),
  order: z.number().min(0),
  start: z.number().min(0).default(0),
  end: z.number().min(0).default(0),
  timelineStart: z.number().min(0).optional(),
  duration: z.number().min(0).default(0),
  meta: JSONField(TimelineClipMetadataSchema).optional(),
});

// Define the collection with workspace-scoped permissions
export const TimelineClipCollection = defineCollection({
  collectionName: 'TimelineClips',
  schema: TimelineClipSchema,
  permissions: {
    // Authenticated users can list timeline clips
    listRule: '@request.auth.id != ""',
    // Authenticated users can view timeline clips
    viewRule: '@request.auth.id != ""',
    // Authenticated users can create timeline clips
    createRule: '@request.auth.id != ""',
    // Authenticated users can update timeline clips
    updateRule: '@request.auth.id != ""',
    // Authenticated users can delete timeline clips
    deleteRule: '@request.auth.id != ""',
  },
});

export default TimelineClipCollection;

// Export TypeScript types
export type TimelineClip = z.infer<typeof TimelineClipSchema>;
export type TimelineClipInput = z.infer<typeof TimelineClipInputSchema>;
export type TimelineClipUpdate = Partial<TimelineClipInput>;
