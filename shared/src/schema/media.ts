import {
  defineCollection,
  RelationField,
  RelationsField,
  SelectField,
  NumberField,
  JSONField,
  TextField,
  baseSchema,
  DateField,
  BoolField,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';
import { MediaType } from '../enums';
import { MediaMetadataSchema } from '../types';
import type { File } from './file';
import type { Upload } from './upload';
import type { Workspace } from './workspace';

// Define the Zod schema
export const MediaSchema = z
  .object({
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    UploadRef: RelationField({ collection: 'Uploads' }),
    mediaType: SelectField([MediaType.VIDEO, MediaType.AUDIO, MediaType.IMAGE]),
    mediaDate: DateField().optional(),
    duration: NumberField(), // seconds as float
    width: NumberField(), // video width in pixels
    height: NumberField(), // video height in pixels
    rotation: NumberField().optional().default(0), // rotation in degrees (0, 90, 180, 270)
    aspectRatio: NumberField(), // calculated aspect ratio (width/height)
    mediaData: JSONField(MediaMetadataSchema), // full probe output
    thumbnailFileRef: RelationField({ collection: 'Files' }).optional(),
    spriteFileRef: RelationField({ collection: 'Files' }).optional(),
    filmstripFileRefs: RelationsField({ collection: 'Files' }).optional(),
    proxyFileRef: RelationField({ collection: 'Files' }).optional(),
    audioFileRef: RelationField({ collection: 'Files' }).optional(),
    hasAudio: BoolField().optional().default(true),
    isActive: BoolField().optional().default(false),
    version: NumberField().default(1).optional(),
    processor: TextField().optional(),
  })
  .extend(baseSchema);

// Define input schema for creating media
export const MediaInputSchema = z.object({
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  UploadRef: z.string().min(1, 'Upload is required'),
  mediaType: z.enum([MediaType.VIDEO, MediaType.AUDIO, MediaType.IMAGE]),
  mediaDate: DateField().optional(),
  duration: NumberField({ min: 0 }),
  width: NumberField({ min: 0 }).optional(),
  height: NumberField({ min: 0 }).optional(),
  aspectRatio: NumberField({ min: 0 }).optional(),
  mediaData: JSONField(MediaMetadataSchema),
  thumbnailFileRef: z.string().optional(),
  spriteFileRef: z.string().optional(),
  filmstripFileRef: z.string().optional(),
  proxyFileRef: z.string().optional(),
  audioFileRef: z.string().optional(),
  hasAudio: z.boolean().optional(),
  isActive: z.boolean().optional(),
  version: NumberField().default(1).optional(),
  processor: z.string().optional(),
});

// Define the collection with workspace-scoped permissions
export const MediaCollection = defineCollection({
  collectionName: 'Media',
  schema: MediaSchema,
  permissions: {
    // Authenticated users can list media
    listRule: '@request.auth.id != ""',
    // Authenticated users can view media
    viewRule: '@request.auth.id != ""',
    // Authenticated users can create media
    createRule: '@request.auth.id != ""',
    // Authenticated users can update media
    updateRule: '@request.auth.id != ""',
    // Authenticated users can delete media
    deleteRule: '@request.auth.id != ""',
  },
});

export default MediaCollection;

// Export TypeScript types
export type Media = Omit<z.infer<typeof MediaSchema>, 'expand'>;
export type MediaInput = z.infer<typeof MediaInputSchema>;
export type MediaUpdate = Partial<MediaInput>;

export interface MediaRelations {
  WorkspaceRef: Workspace;
  UploadRef: Upload;
  thumbnailFileRef?: File;
  spriteFileRef?: File;
  filmstripFileRefs?: File[];
  proxyFileRef?: File;
  audioFileRef?: File;
}
