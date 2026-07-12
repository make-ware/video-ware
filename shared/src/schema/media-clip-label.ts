import {
  defineCollection,
  RelationField,
  SelectField,
  NumberField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { workspaceScopedPermissions } from '../utils/collection-permissions';
import { z } from 'zod';
import { LabelType } from '../enums';

/**
 * MediaClipLabels is an explicit many-to-many join between MediaClips and the
 * label collections: each row records that a clip was created from (or is
 * backed by) a specific label row — e.g. "this clip exists because of this
 * portion of the transcript" or "this clip tracks this faceId". The
 * ClipLabelSearch view intersects clips and labels implicitly by time
 * overlap; this collection is the explicit provenance link, so it survives
 * the clip being edited away from the label's time window.
 *
 * Exactly one Label*Ref must be set per row, matching labelType.
 */

/** Maps a LabelType to the relation field that must be set for that type. */
export const LABEL_TYPE_TO_REF_FIELD = {
  [LabelType.OBJECT]: 'LabelObjectRef',
  [LabelType.SHOT]: 'LabelShotRef',
  [LabelType.PERSON]: 'LabelPersonRef',
  [LabelType.SPEECH]: 'LabelSpeechRef',
  [LabelType.SPEAKER]: 'LabelSpeakerRef',
  [LabelType.FACE]: 'LabelFaceRef',
  [LabelType.SEGMENT]: 'LabelSegmentRef',
  [LabelType.TEXT]: 'LabelTextRef',
} as const satisfies Record<LabelType, string>;

export type MediaClipLabelRefField =
  (typeof LABEL_TYPE_TO_REF_FIELD)[LabelType];

// Define the Zod schema
export const MediaClipLabelSchema = z
  .object({
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    MediaClipRef: RelationField({ collection: 'MediaClips' }),
    labelType: SelectField([
      LabelType.OBJECT,
      LabelType.SHOT,
      LabelType.PERSON,
      LabelType.SPEECH,
      LabelType.SPEAKER,
      LabelType.FACE,
      LabelType.SEGMENT,
      LabelType.TEXT,
    ]),
    LabelObjectRef: RelationField({ collection: 'LabelObjects' }).optional(),
    LabelShotRef: RelationField({ collection: 'LabelShots' }).optional(),
    LabelPersonRef: RelationField({ collection: 'LabelPerson' }).optional(),
    LabelSpeechRef: RelationField({ collection: 'LabelSpeech' }).optional(),
    LabelSpeakerRef: RelationField({ collection: 'LabelSpeaker' }).optional(),
    LabelFaceRef: RelationField({ collection: 'LabelFaces' }).optional(),
    LabelSegmentRef: RelationField({ collection: 'LabelSegments' }).optional(),
    LabelTextRef: RelationField({ collection: 'LabelText' }).optional(),
    confidence: NumberField({ min: 0, max: 1 }).optional(), // label confidence at link time
    metadata: JSONField().optional(), // link context, e.g. matched transcript text
  })
  .extend(baseSchema);

// Define input schema for creating media clip label links
export const MediaClipLabelInputSchema = z
  .object({
    WorkspaceRef: z.string().min(1, 'Workspace is required'),
    MediaClipRef: z.string().min(1, 'Media clip is required'),
    labelType: z.enum(LabelType),
    LabelObjectRef: z.string().optional(),
    LabelShotRef: z.string().optional(),
    LabelPersonRef: z.string().optional(),
    LabelSpeechRef: z.string().optional(),
    LabelSpeakerRef: z.string().optional(),
    LabelFaceRef: z.string().optional(),
    LabelSegmentRef: z.string().optional(),
    LabelTextRef: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    metadata: JSONField().optional(),
  })
  .superRefine((input, ctx) => {
    const refField = LABEL_TYPE_TO_REF_FIELD[input.labelType];
    if (!input[refField]) {
      ctx.addIssue({
        code: 'custom',
        path: [refField],
        message: `${refField} is required when labelType is "${input.labelType}"`,
      });
    }
  });

// Define the collection
export const MediaClipLabelCollection = defineCollection({
  collectionName: 'MediaClipLabels',
  schema: MediaClipLabelSchema,
  permissions: workspaceScopedPermissions(),
  indexes: [
    'CREATE INDEX idx_mediaclip_labels_workspace ON MediaClipLabels (WorkspaceRef)',
    'CREATE INDEX idx_mediaclip_labels_clip ON MediaClipLabels (MediaClipRef)',
    'CREATE INDEX idx_mediaclip_labels_object ON MediaClipLabels (LabelObjectRef)',
    'CREATE INDEX idx_mediaclip_labels_shot ON MediaClipLabels (LabelShotRef)',
    'CREATE INDEX idx_mediaclip_labels_person ON MediaClipLabels (LabelPersonRef)',
    'CREATE INDEX idx_mediaclip_labels_speech ON MediaClipLabels (LabelSpeechRef)',
    'CREATE INDEX idx_mediaclip_labels_speaker ON MediaClipLabels (LabelSpeakerRef)',
    'CREATE INDEX idx_mediaclip_labels_face ON MediaClipLabels (LabelFaceRef)',
    'CREATE INDEX idx_mediaclip_labels_segment ON MediaClipLabels (LabelSegmentRef)',
    'CREATE INDEX idx_mediaclip_labels_text ON MediaClipLabels (LabelTextRef)',
    // Empty relations are stored as '' so this rejects duplicate edges
    'CREATE UNIQUE INDEX idx_mediaclip_labels_unique ON MediaClipLabels (MediaClipRef, labelType, LabelObjectRef, LabelShotRef, LabelPersonRef, LabelSpeechRef, LabelSpeakerRef, LabelFaceRef, LabelSegmentRef, LabelTextRef)',
  ],
});

export default MediaClipLabelCollection;

// Export TypeScript types
export type MediaClipLabel = z.infer<typeof MediaClipLabelSchema>;
export type MediaClipLabelInput = z.infer<typeof MediaClipLabelInputSchema>;
export type MediaClipLabelUpdate = Partial<MediaClipLabelInput>;
