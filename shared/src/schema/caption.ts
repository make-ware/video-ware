import {
  defineCollection,
  NumberField,
  RelationField,
  SelectField,
  TextField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';
import { CaptionType } from '../enums';
import { CaptionCueSchema, CaptionStyleSchema } from '../types/captions';

// Captions hold user-visible text overlays (subtitles and title screens).
// Transcript-derived (TTS) captions and ad-hoc captions share this model:
// a transcript caption is attached to its source media via MediaRef, while
// an ad-hoc caption has no MediaRef and is placed on timelines directly
// through TimelineClips.CaptionRef.
export const CaptionSchema = z
  .object({
    // --- Relations ---
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    MediaRef: RelationField({ collection: 'Media' }).optional(),
    UserRef: RelationField({ collection: 'Users' }).optional(),

    // --- Identification ---
    name: TextField().optional(),
    captionType: SelectField([CaptionType.CAPTION, CaptionType.TITLE]),

    // --- Content ---
    text: TextField({ min: 1 }), // full/fallback text shown when no cue is active
    cues: JSONField(z.array(CaptionCueSchema)).optional(), // timed text changes, relative to caption start

    // --- Timing ---
    duration: NumberField({ min: 0 }), // intrinsic caption duration (seconds)
    start: NumberField({ min: 0 }).optional(), // position in source media (media-attached captions)
    end: NumberField({ min: 0 }).optional(),

    // --- Presentation ---
    style: JSONField(CaptionStyleSchema).optional(),

    // --- Metadata ---
    metadata: JSONField().optional(),
  })
  .extend(baseSchema);

export const CaptionInputSchema = z.object({
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  MediaRef: z.string().optional(),
  UserRef: z.string().optional(),

  name: z.string().optional(),
  captionType: z.enum(CaptionType),

  text: z.string().min(1, 'Caption text is required'),
  cues: z.array(CaptionCueSchema).optional(),

  duration: z.number().min(0),
  start: z.number().min(0).optional(),
  end: z.number().min(0).optional(),

  style: CaptionStyleSchema.optional(),
  metadata: JSONField().optional(),
});

export const CaptionCollection = defineCollection({
  collectionName: 'Captions',
  schema: CaptionSchema,
  permissions: {
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
  },
  indexes: [
    'CREATE INDEX idx_captions_workspace ON Captions (WorkspaceRef)',
    'CREATE INDEX idx_captions_media ON Captions (MediaRef)',
  ],
});

export default CaptionCollection;

// Export TypeScript types
export type Caption = z.infer<typeof CaptionSchema>;
export type CaptionInput = z.infer<typeof CaptionInputSchema>;
export type CaptionUpdate = Partial<CaptionInput>;
