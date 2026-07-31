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
} from 'pocketbase-zod-schema';
import { workspaceScopedPermissions } from '../utils/collection-permissions';
import { z } from 'zod';
import { MediaType } from '../enums';
import {
  CropRectSchema,
  CropSuggestionSchema,
  MediaMetadataSchema,
} from '../types';
import type { Directory } from './directory';
import type { File } from './file';
import type { Upload } from './upload';
import type { Workspace } from './workspace';

// Define the Zod schema
export const MediaSchema = z
  .object({
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    UploadRef: RelationField({ collection: 'Uploads' }),
    mediaType: SelectField([MediaType.VIDEO, MediaType.AUDIO, MediaType.IMAGE]),
    // Source file name, denormalized from UploadRef.name at ingest so lists can
    // sort/filter/display without expanding Uploads. `label` (below) is the
    // editor's override; display order is label -> name.
    name: TextField({ max: 255 }).optional(),
    label: TextField().optional(), // editor-facing name, searchable
    description: TextField().optional(), // editor-facing notes, searchable
    mediaDate: DateField().optional(),
    duration: NumberField(), // seconds as float
    width: NumberField(), // video width in pixels
    height: NumberField(), // video height in pixels
    rotation: NumberField().optional().default(0), // rotation in degrees (0, 90, 180, 270)
    // Default source crop applied to every placement (e.g. strip burned-in
    // letterbox bars): 0–1 fractions of the DISPLAY frame (post-rotation).
    // Bounds are enforced here via CropRectSchema, never in the DB column.
    crop: JSONField(CropRectSchema).optional(),
    // Last ffmpeg `cropdetect` recommendation from the ingest AUTOCROP step,
    // written whether or not it was applied to `crop` — it is the audit trail
    // that explains the crop (and records why there is none).
    cropSuggestion: JSONField(CropSuggestionSchema).optional(),
    aspectRatio: NumberField(), // calculated aspect ratio (width/height)
    mediaData: JSONField(MediaMetadataSchema), // full probe output
    thumbnailFileRef: RelationField({ collection: 'Files' }).optional(),
    spriteFileRef: RelationField({ collection: 'Files' }).optional(),
    filmstripFileRefs: RelationsField({ collection: 'Files' }).optional(),
    // Audio waveform PNGs, one per chunk, ordered by meta.waveformConfig
    // .chunkIndex (never rely on relation order — see normalizeWaveformChunks).
    waveformFileRefs: RelationsField({ collection: 'Files' }).optional(),
    proxyFileRef: RelationField({ collection: 'Files' }).optional(),
    audioFileRef: RelationField({ collection: 'Files' }).optional(),
    hasAudio: BoolField().optional().default(true),
    isActive: BoolField().optional().default(false),
    version: NumberField().default(1).optional(),
    processor: TextField().optional(),
    DirectoryRef: RelationField({ collection: 'Directories' }).optional(),
  })
  .extend(baseSchema);

// Define input schema for creating media
export const MediaInputSchema = z.object({
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  UploadRef: z.string().min(1, 'Upload is required'),
  mediaType: z.enum([MediaType.VIDEO, MediaType.AUDIO, MediaType.IMAGE]),
  name: z.string().max(255).optional(),
  label: z.string().optional(),
  description: z.string().optional(),
  mediaDate: DateField().optional(),
  duration: NumberField({ min: 0 }),
  width: NumberField({ min: 0 }).optional(),
  height: NumberField({ min: 0 }).optional(),
  // Degrees (0/90/180/270). Written by the PROBE step: `width`/`height` are the
  // coded dimensions, and this is what turns them into display dimensions.
  rotation: NumberField({ min: 0 }).optional(),
  // Default source crop, display-frame fractions (see MediaSchema.crop).
  crop: CropRectSchema.optional(),
  // Autocrop detection record (see MediaSchema.cropSuggestion).
  cropSuggestion: CropSuggestionSchema.optional(),
  aspectRatio: NumberField({ min: 0 }).optional(),
  mediaData: JSONField(MediaMetadataSchema),
  thumbnailFileRef: z.string().optional(),
  spriteFileRef: z.string().optional(),
  filmstripFileRef: z.string().optional(),
  waveformFileRefs: z.array(z.string()).optional(),
  proxyFileRef: z.string().optional(),
  audioFileRef: z.string().optional(),
  hasAudio: z.boolean().optional(),
  isActive: z.boolean().optional(),
  version: NumberField().default(1).optional(),
  processor: z.string().optional(),
  DirectoryRef: z.string().optional(),
});

// Define the collection with workspace-scoped permissions
export const MediaCollection = defineCollection({
  collectionName: 'Media',
  schema: MediaSchema,
  permissions: workspaceScopedPermissions(),
  indexes: [
    // Workspace-scoped name sorts/searches — every media list is filtered by
    // workspace first, so the pair is what the planner can actually use.
    'CREATE INDEX idx_media_workspace_name ON Media (WorkspaceRef, name)',
  ],
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
  waveformFileRefs?: File[];
  proxyFileRef?: File;
  audioFileRef?: File;
  DirectoryRef?: Directory;
}
