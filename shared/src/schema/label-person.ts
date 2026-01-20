import {
  defineCollection,
  RelationField,
  TextField,
  BoolField,
  NumberField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';

// Define the Zod schema for LabelPerson
export const LabelPersonSchema = z
  .object({
    // --- Relations ---
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    MediaRef: RelationField({ collection: 'Media' }),
    LabelEntityRef: RelationField({ collection: 'LabelEntity' }),
    LabelTrackRef: RelationField({ collection: 'LabelTrack' }),

    // --- Identification ---
    // The specific track ID returned by Google (e.g. "0", "1")
    personId: TextField(),
    // Unique constraint (MediaRef + personId)
    personHash: TextField({ min: 1 }),

    // --- Timing & Confidence ---
    start: NumberField({ min: 0 }),
    end: NumberField({ min: 0 }),
    duration: NumberField({ min: 0 }),
    confidence: NumberField({ min: 0, max: 1 }),

    // --- Person Specific Attributes ---
    // Google often returns "upper_body_color" and "lower_body_color".
    // Extracting the most frequent/confident color to a top-level field makes search easy
    // e.g., "Find all people wearing Red"
    upperBodyColor: TextField().optional(),
    lowerBodyColor: TextField().optional(),

    // Boolean flag to quickly identify if this track includes pose landmarks
    hasLandmarks: BoolField().optional(),

    // --- Extra Data ---
    // Store all other attributes (e.g., "bag", "hat") or raw attribute confidence scores here
    metadata: JSONField(),
  })
  .extend(baseSchema);

// Define input schema for creating label people
export const LabelPersonInputSchema = z.object({
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  MediaRef: z.string().min(1, 'Media is required'),
  LabelEntityRef: z.string(),

  // Reference to the heavy geometric data (bboxes + landmarks)
  LabelTrackRef: z.string(),

  // --- Identification ---
  personId: z.string(),
  personHash: z.string().min(1, 'Person hash is required'),

  // --- Timing & Confidence ---
  start: z.number().min(0),
  end: z.number().min(0),
  duration: z.number().min(0),
  confidence: z.number().min(0).max(1),

  // --- Person Specific Attributes ---
  upperBodyColor: z.string().optional(),
  lowerBodyColor: z.string().optional(),
  hasLandmarks: z.boolean().optional(),

  // --- Extra Data ---
  metadata: JSONField(),
});

// Define the collection
export const LabelPersonCollection = defineCollection({
  collectionName: 'LabelPerson',
  schema: LabelPersonSchema,
  permissions: {
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
  },
  indexes: [
    'CREATE UNIQUE INDEX idx_label_person_hash ON LabelPerson (personHash)',
    'CREATE INDEX idx_label_person_workspace ON LabelPerson (WorkspaceRef)',
    'CREATE INDEX idx_label_person_media ON LabelPerson (MediaRef)',
    'CREATE INDEX idx_label_person_track ON LabelPerson (LabelTrackRef)',
  ],
});

export default LabelPersonCollection;

export type LabelPerson = z.infer<typeof LabelPersonSchema>;
export type LabelPersonInput = z.infer<typeof LabelPersonInputSchema>;
export type LabelPersonUpdate = Partial<LabelPersonInput>;
