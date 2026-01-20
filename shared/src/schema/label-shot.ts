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
export const LabelShotSchema = z
  .object({
    // --- Relations ---
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    MediaRef: RelationField({ collection: 'Media' }),
    LabelEntityRef: RelationField({ collection: 'LabelEntity' }).optional(),

    // --- Identification ---
    // Denormalized name (e.g., "nature", "mountain") for easy querying without expansion
    entity: TextField(),
    shotHash: TextField({ min: 1 }), // Unique constraint (e.g. hash of mediaId + entity + start + end)

    // --- Timing & Confidence ---
    // Mapped from the "segments" array in your JSON
    start: NumberField({ min: 0 }), // seconds
    end: NumberField({ min: 0 }), // seconds
    duration: NumberField({ min: 0 }), // end - start

    // Mapped from the segment confidence (or top-level entity confidence)
    confidence: NumberField({ min: 0, max: 1 }),

    // Optional: Store the raw segment data or siblings if needed
    metadata: JSONField(),
  })
  .extend(baseSchema);

// Define input schema for creating label shots
export const LabelShotInputSchema = z.object({
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  MediaRef: z.string().min(1, 'Media is required'),
  LabelEntityRef: z.string().optional(),
  entity: z.string(),
  shotHash: z.string().min(1, 'Shot hash is required'),
  start: z.number().min(0),
  end: z.number().min(0),
  duration: z.number().min(0),
  confidence: z.number().min(0).max(1),
  metadata: JSONField(),
});

// Define the collection
export const LabelShotCollection = defineCollection({
  collectionName: 'LabelShots',
  schema: LabelShotSchema,
  permissions: {
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
  },
  indexes: [
    'CREATE UNIQUE INDEX idx_label_shot_hash ON LabelShot (shotHash)',
    'CREATE INDEX idx_label_shot_workspace ON LabelShot (WorkspaceRef)',
    'CREATE INDEX idx_label_shot_media ON LabelShot (MediaRef)',
    'CREATE INDEX idx_label_shot_entity ON LabelShot (LabelEntityRef)',
  ],
});

export default LabelShotCollection;

// Export TypeScript types
export type LabelShot = z.infer<typeof LabelShotSchema>;
export type LabelShotInput = z.infer<typeof LabelShotInputSchema>;
export type LabelShotUpdate = Partial<LabelShotInput>;
