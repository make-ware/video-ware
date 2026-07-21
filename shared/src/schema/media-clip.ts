import {
  defineCollection,
  RelationField,
  NumberField,
  JSONField,
  baseSchema,
  TextField,
} from 'pocketbase-zod-schema/schema';
import { workspaceScopedPermissions } from '../utils/collection-permissions';
import { z } from 'zod';
import { ClipType } from '../enums';
import { MediaClipMetadataSchema } from '../types';

// Define the Zod schema
export const MediaClipSchema = z
  .object({
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    MediaRef: RelationField({ collection: 'Media' }),
    type: TextField(),
    label: TextField().optional(), // editor-facing name, searchable
    description: TextField().optional(), // editor-facing notes, searchable
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
  ]),
  label: z.string().optional(),
  description: z.string().optional(),
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
  permissions: workspaceScopedPermissions(),
  indexes: [
    'CREATE INDEX idx_mediaclips_workspace ON MediaClips (WorkspaceRef)',
    'CREATE INDEX idx_mediaclips_media ON MediaClips (MediaRef)',
  ],
});

export default MediaClipCollection;

// Export TypeScript types
export type MediaClip = z.infer<typeof MediaClipSchema>;
export type MediaClipInput = z.infer<typeof MediaClipInputSchema>;
export type MediaClipUpdate = Partial<MediaClipInput>;
