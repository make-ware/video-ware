import {
  defineCollection,
  RelationField,
  SelectField,
  TextField,
  NumberField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema';
import { workspaceScopedPermissions } from '../utils/collection-permissions';
import { LabelType } from '../enums';
import { z } from 'zod';

/**
 * Every label kind a track can belong to — the same set as
 * LabelEntity.labelType, which is where the value is denormalized from.
 */
export const LABEL_TRACK_TYPE_VALUES = [
  LabelType.OBJECT,
  LabelType.SHOT,
  LabelType.PERSON,
  LabelType.SPEECH,
  LabelType.SPEAKER,
  LabelType.FACE,
  LabelType.SEGMENT,
  LabelType.TEXT,
] as const;

// Define the Zod schema for LabelTrack
export const LabelTrackSchema = z
  .object({
    // --- Relations ---
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    MediaRef: RelationField({ collection: 'Media', cascadeDelete: true }),
    LabelEntityRef: RelationField({ collection: 'LabelEntity' }).optional(),
    // RETIRED — do not read, do not write. The manual "this track is Erik"
    // link moved to LabelEntity.EntityRef when LabelEntity became per-media
    // and per-instance; the per-instance migration folded every value here
    // into that field and left this one populated purely as a recovery net.
    // A write lands in the database and changes nothing, which is why the
    // mutator no longer offers one. Dropped by a later migration.
    EntityRef: RelationField({ collection: 'Entities' }).optional(),

    // --- Identification ---
    trackId: TextField(), // The stable ID from the provider (e.g., "0")
    trackHash: TextField({ min: 1 }), // Unique constraint (MediaRef + trackId + provider)
    // Denormalized copy of LabelEntityRef -> LabelEntity.labelType. One media
    // routinely holds hundreds of object tracks alongside a handful of speaker
    // or face tracks, so "this media's speaker tracks" has to be an indexed
    // filter rather than a paged scan of every track plus a relation
    // traversal. Safe to denormalize: a cluster's labelType is set at creation
    // and never changes. Optional because a track written without a
    // LabelEntityRef has no type to inherit.
    labelType: SelectField([...LABEL_TRACK_TYPE_VALUES]).optional(),

    // --- Timing ---
    start: NumberField({ min: 0 }), // Seconds (from first keyframe)
    end: NumberField({ min: 0 }), // Seconds (from last keyframe)
    duration: NumberField({ min: 0 }),

    // --- Spatial Summary ---
    // The union of every keyframe's box — the area covering the entire path —
    // so a spatial question ("find movement in the top-right corner") is an
    // indexed row read instead of a parse of the 10MB keyframes JSON.
    // Format: { left, top, right, bottom }, normalized 0-1 like the keyframes.
    //
    // Written by the four spatial normalizers via `unionBbox`, healed onto
    // already-persisted rows by the step processors, and backfilled for older
    // rows by 1785740000_labeltrack_boundingbox_backfill.js. Optional because
    // speech and speaker tracks have no spatial data at all — an empty box on
    // those is the correct state. Readers still derive the union from
    // keyframes when it is empty, so a row that predates all three paths is
    // correct, just not cheap.
    boundingBox: JSONField().optional(),

    // --- The Heavy Data ---
    // Array: [{ "t": 0.1, "bbox": { left, top, right, bottom }, "confidence": 0.9 }]
    // — `t` is ABSOLUTE media seconds (the first entry's equals `start`) and
    // every coordinate is a 0-1 fraction of the frame. Parse it through
    // `normalizeKeyframes` rather than by hand.
    // `.optional()` is load-bearing and must stay: speech and speaker tracks
    // have no spatial keyframes and write `[]`, which PocketBase counts as
    // empty, so a required field rejects them. The live column has been
    // required: false since 1768293966_updated_LabelTrack.js — declaring it
    // required here is what makes `db:status` propose flipping it back. Every
    // reader already guards with `Array.isArray`. The 10MB cap replaces
    // PocketBase's 1MB JSON default, which dense object tracks over long videos
    // exceed (see 1783296003_updated_LabelTrack_keyframes_maxsize.js).
    keyframes: JSONField({ maxSize: 10485760 }).optional(), // 10MB

    // --- Metadata ---
    confidence: NumberField({ min: 0, max: 1 }), // Average or Max confidence of the track
    trackData: JSONField(), // Any extra attributes (e.g., detected attributes like "sitting")
  })
  .extend(baseSchema);

// Define input schema for creating label tracks
export const LabelTrackInputSchema = z.object({
  // --- Relations ---
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  MediaRef: z.string().min(1, 'Media is required'),
  LabelEntityRef: z.string().optional(),
  // Retired alongside the schema field above — declared so a stray write is
  // at least visible in the record rather than silently dropped, never sent
  // by anything in the codebase.
  EntityRef: z.string().optional(),

  // --- Identification ---
  trackId: z.string().min(1, 'Track ID is required'),
  trackHash: z.string().min(1, 'Track hash is required'),
  // Must be listed here or it never persists: this is a non-strict z.object,
  // so validateInput silently drops any key it doesn't declare (which is why
  // the worker's provider/processor/version writes vanish).
  labelType: z.enum(LabelType).optional(),

  // --- Timing ---
  start: z.number().min(0),
  end: z.number().min(0),
  duration: z.number().min(0),

  boundingBox: JSONField().optional(),
  keyframes: z.array(z.unknown()),
  confidence: z.number().min(0).max(1),
  trackData: JSONField(),
});

// Define the collection with workspace-scoped permissions
export const LabelTrackCollection = defineCollection({
  collectionName: 'LabelTrack',
  schema: LabelTrackSchema,
  permissions: workspaceScopedPermissions(),
  indexes: [
    // Unique constraint on trackHash for deduplication
    'CREATE UNIQUE INDEX idx_label_track_hash ON LabelTrack (trackHash)',
    // Index for media + entity queries
    'CREATE INDEX idx_label_track_media_entity ON LabelTrack (MediaRef, LabelEntityRef)',
    // Index for workspace + media queries
    'CREATE INDEX idx_label_track_workspace_media ON LabelTrack (WorkspaceRef, MediaRef)',
    // Vestigial, like the EntityRef field it covers — kept only so the index
    // set matches the live database until the drop migration removes both.
    'CREATE INDEX idx_label_track_entity ON LabelTrack (EntityRef)',
    // The attribution hop: "tracks whose LabelEntity is linked to X", which
    // the (MediaRef, LabelEntityRef) composite can't serve on its own.
    'CREATE INDEX idx_label_track_cluster ON LabelTrack (LabelEntityRef)',
    // "This media's tracks of kind X" — the speaker/face identification UIs.
    'CREATE INDEX idx_label_track_media_type ON LabelTrack (MediaRef, labelType)',
  ],
});

export default LabelTrackCollection;

// Export TypeScript types
export type LabelTrack = z.infer<typeof LabelTrackSchema>;
export type LabelTrackInput = z.infer<typeof LabelTrackInputSchema>;
export type LabelTrackUpdate = Partial<LabelTrackInput>;
