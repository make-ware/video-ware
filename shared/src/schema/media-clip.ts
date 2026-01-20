import {
  defineCollection,
  RelationField,
  NumberField,
  JSONField,
  baseSchema,
  TextField,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';
import { ClipType } from '../enums';
import { MediaClipMetadataSchema } from '../types';

// Define the Zod schema
export const MediaClipSchema = z
  .object({
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    MediaRef: RelationField({ collection: 'Media' }),
    type: TextField(),
    start: NumberField({ min: 0 }), // seconds
    end: NumberField({ min: 0 }), // seconds
    duration: NumberField({ min: 0 }), // seconds
    clipData: JSONField(MediaClipMetadataSchema).optional(), // additional data
    version: NumberField().default(1),
    processor: TextField().optional(),
  })
  .extend(baseSchema);

// Define input schema for creating media clips
export const MediaClipInputSchema = z.object({
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  MediaRef: z.string().min(1, 'Media is required'),
  type: z.enum([
    ClipType.USER,
    ClipType.FULL,
    ClipType.RANGE,
    ClipType.SHOT,
    ClipType.OBJECT,
    ClipType.PERSON,
    ClipType.FACE,
    ClipType.SPEECH,
    ClipType.RECOMMENDATION,
  ]),
  start: NumberField({ min: 0 }),
  end: NumberField({ min: 0 }),
  duration: NumberField({ min: 0 }),
  clipData: JSONField(MediaClipMetadataSchema).optional(),
  version: NumberField().default(1),
  processor: z.string().optional(),
});

// Define the collection with workspace-scoped permissions
export const MediaClipCollection = defineCollection({
  collectionName: 'MediaClips',
  schema: MediaClipSchema,
  permissions: {
    // Authenticated users can list media clips
    listRule: '@request.auth.id != ""',
    // Authenticated users can view media clips
    viewRule: '@request.auth.id != ""',
    // Authenticated users can create media clips
    createRule: '@request.auth.id != ""',
    // Authenticated users can update media clips
    updateRule: '@request.auth.id != ""',
    // Authenticated users can delete media clips
    deleteRule: '@request.auth.id != ""',
  },
});

export default MediaClipCollection;

// Export TypeScript types
export type MediaClip = z.infer<typeof MediaClipSchema>;
export type MediaClipInput = z.infer<typeof MediaClipInputSchema>;
export type MediaClipUpdate = Partial<MediaClipInput>;
