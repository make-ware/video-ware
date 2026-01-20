import {
  defineCollection,
  RelationField,
  TextField,
  NumberField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';

// Define the Zod schema for LabelTrack
export const LabelTrackSchema = z
  .object({
    // --- Relations ---
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    MediaRef: RelationField({ collection: 'Media' }),
    LabelEntityRef: RelationField({ collection: 'LabelEntity' }).optional(),

    // --- Identification ---
    trackId: TextField(), // The stable ID from the provider (e.g., "0")
    trackHash: TextField({ min: 1 }), // Unique constraint (MediaRef + trackId + provider)

    // --- Timing ---
    start: NumberField({ min: 0 }), // Seconds (from first keyframe)
    end: NumberField({ min: 0 }), // Seconds (from last keyframe)
    duration: NumberField({ min: 0 }),

    // --- Spatial Summary (New Recommendation) ---
    // Storing the "Union" Bounding Box (the area covering the entire path)
    // allows you to spatially search (e.g., "Find movement in the top-right corner")
    // without parsing the huge keyframes JSON.
    // Format: { top, left, bottom, right }
    boundingBox: JSONField().optional(),

    // --- The Heavy Data ---
    // Array: [{ "timeOffset": 0.1, "boundingBox": {...}, "confidence": 0.9 }]
    keyframes: JSONField(),

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

  // --- Identification ---
  trackId: z.string().min(1, 'Track ID is required'),
  trackHash: z.string().min(1, 'Track hash is required'),

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
  permissions: {
    // Authenticated users can list label tracks
    listRule: '@request.auth.id != ""',
    // Authenticated users can view label tracks
    viewRule: '@request.auth.id != ""',
    // Authenticated users can create label tracks
    createRule: '@request.auth.id != ""',
    // Authenticated users can update label tracks
    updateRule: '@request.auth.id != ""',
    // Authenticated users can delete label tracks
    deleteRule: '@request.auth.id != ""',
  },
  indexes: [
    // Unique constraint on trackHash for deduplication
    'CREATE UNIQUE INDEX idx_label_track_hash ON LabelTrack (trackHash)',
    // Index for media + entity queries
    'CREATE INDEX idx_label_track_media_entity ON LabelTrack (MediaRef, LabelEntityRef)',
    // Index for workspace + media queries
    'CREATE INDEX idx_label_track_workspace_media ON LabelTrack (WorkspaceRef, MediaRef)',
  ],
});

export default LabelTrackCollection;

// Export TypeScript types
export type LabelTrack = z.infer<typeof LabelTrackSchema>;
export type LabelTrackInput = z.infer<typeof LabelTrackInputSchema>;
export type LabelTrackUpdate = Partial<LabelTrackInput>;
