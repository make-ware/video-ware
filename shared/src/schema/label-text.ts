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
export const LabelTextSchema = z
  .object({
    // --- Relations ---
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    MediaRef: RelationField({ collection: 'Media' }),
    LabelTrackRef: RelationField({ collection: 'LabelTrack' }).optional(),
    LabelEntityRef: RelationField({ collection: 'LabelEntity' }).optional(),

    // --- Content ---
    text: TextField({ min: 1 }),
    textHash: TextField({ min: 1 }),

    // --- Timing ---
    start: NumberField({ min: 0 }),
    end: NumberField({ min: 0 }),
    duration: NumberField({ min: 0 }),

    confidence: NumberField({ min: 0, max: 1 }),
    metadata: JSONField().optional(),
  })
  .extend(baseSchema);

// Define input schema for creating label shots
export const LabelTextInputSchema = z.object({
  // --- Relations ---
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  MediaRef: z.string().min(1, 'Media is required'),
  LabelTrackRef: z.string().optional(),
  LabelEntityRef: z.string().optional(),

  // --- Content ---
  text: z.string(),
  textHash: z.string().min(1, 'Text hash is required'),

  // --- Timing ---
  start: z.number().min(0),
  end: z.number().min(0),
  duration: z.number().min(0),

  confidence: z.number().min(0).max(1),
  metadata: JSONField(),
});

// Define the collection
export const LabelTextCollection = defineCollection({
  collectionName: 'LabelText',
  schema: LabelTextSchema,
  permissions: {
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
  },
  indexes: [
    'CREATE UNIQUE INDEX idx_label_text_hash ON LabelText (textHash)',
    'CREATE INDEX idx_label_text_workspace ON LabelText (WorkspaceRef)',
    'CREATE INDEX idx_label_text_media ON LabelText (MediaRef)',
    'CREATE INDEX idx_label_text_entity ON LabelText (LabelEntityRef)',
  ],
});

export default LabelTextCollection;

// Export TypeScript types
export type LabelText = z.infer<typeof LabelTextSchema>;
export type LabelTextInput = z.infer<typeof LabelTextInputSchema>;
export type LabelTextUpdate = Partial<LabelTextInput>;
