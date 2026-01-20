import {
  defineCollection,
  RelationField,
  TextField,
  NumberField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';

// Define the Zod schema for LabelShot
export const LabelObjectSchema = z
  .object({
    // --- Relations ---
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    MediaRef: RelationField({ collection: 'Media' }),
    LabelEntityRef: RelationField({ collection: 'LabelEntity' }), // Links to "Person"
    LabelTrackRef: RelationField({ collection: 'LabelTrack' }).optional(),

    // --- Identification ---
    entity: TextField(), // "person"
    originalTrackId: TextField(), // "0" (The ID from the provider)
    objectHash: TextField({ min: 1 }), // Unique constraint

    // --- Timing & Confidence ---
    // Calculated from the frames array (min/max timeOffset)
    start: NumberField({ min: 0 }),
    end: NumberField({ min: 0 }),
    duration: NumberField({ min: 0 }),

    // Overall confidence from the root object
    confidence: NumberField({ min: 0, max: 1 }),

    // --- System ---
    version: NumberField().default(1).optional(),
    metadata: JSONField(), // Extra attributes not fitting elsewhere
  })
  .extend(baseSchema);

// Define input schema for creating label objects
export const LabelObjectInputSchema = z.object({
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  MediaRef: z.string().min(1, 'Media is required'),
  LabelEntityRef: z.string(),
  LabelTrackRef: z.string(),

  // --- Identification ---
  entity: z.string(), // "person"
  originalTrackId: z.string(), // "0" (The ID from the provider)
  objectHash: z.string().min(1, 'Object hash is required'),

  // --- Timing & Confidence ---
  start: z.number().min(0),
  end: z.number().min(0),
  duration: z.number().min(0),
  confidence: z.number().min(0).max(1),

  // --- System ---
  version: z.number().optional(),
  metadata: JSONField(),
});

// Define the collection
export const LabelObjectCollection = defineCollection({
  collectionName: 'LabelObjects',
  schema: LabelObjectSchema,
  permissions: {
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
  },
  indexes: [
    'CREATE UNIQUE INDEX idx_label_object_hash ON LabelObjects (objectHash)',
    'CREATE INDEX idx_label_object_workspace ON LabelObjects (WorkspaceRef)',
    'CREATE INDEX idx_label_object_media ON LabelObjects (MediaRef)',
    'CREATE INDEX idx_label_object_track ON LabelObjects (LabelTrackRef)',
  ],
});

export default LabelObjectCollection;

export type LabelObject = z.infer<typeof LabelObjectSchema>;
export type LabelObjectInput = z.infer<typeof LabelObjectInputSchema>;
export type LabelObjectUpdate = Partial<LabelObjectInput>;
