import {
  defineCollection,
  RelationField,
  TextField,
  NumberField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';
// Define word timing structure for reference/validation
// (This validates the content inside the JSONField)
const WordTimingSchema = z.object({
  word: z.string(),
  startTime: z.number(), // specific to word alignment
  endTime: z.number(), // specific to word alignment
  confidence: z.number(),
  speakerTag: z.number().optional(),
});

export const LabelSpeechSchema = z
  .object({
    // --- Relations ---
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    MediaRef: RelationField({ collection: 'Media' }),
    LabelTrackRef: RelationField({ collection: 'LabelTrack' }).optional(),
    LabelEntityRef: RelationField({ collection: 'LabelEntity' }).optional(),

    // --- Content ---
    transcript: TextField({ min: 1 }),
    languageCode: TextField().optional(), // e.g. "en-US"

    // --- Timing (Standardized) ---
    start: NumberField({ min: 0 }),
    end: NumberField({ min: 0 }),
    duration: NumberField({ min: 0 }),

    // --- Details ---
    speakerTag: NumberField().optional(), // Raw integer tag from Google
    words: JSONField(), // Stores array of WordTimingSchema

    // --- Metadata ---
    confidence: NumberField({ min: 0, max: 1 }),
    metadata: JSONField().optional(),
    speechHash: TextField({ min: 1 }), // Unique constraint
  })
  .extend(baseSchema);

// Define input schema for creating label speech
export const LabelSpeechInputSchema = z.object({
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  MediaRef: z.string().min(1, 'Media is required'),
  LabelEntityRef: z.string().optional(),
  LabelTrackRef: z.string().optional(),

  transcript: z.string().min(1, 'Transcript is required'),
  start: z.number().min(0),
  end: z.number().min(0),
  duration: z.number().min(0),
  confidence: z.number().min(0).max(1),

  speakerTag: z.number().optional(),
  languageCode: z.string().optional(),

  words: z.array(WordTimingSchema),

  metadata: JSONField().optional(),
  speechHash: z.string().min(1, 'Speech hash is required'),
});

// Define the collection
export const LabelSpeechCollection = defineCollection({
  collectionName: 'LabelSpeech',
  schema: LabelSpeechSchema,
  permissions: {
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
  },
  indexes: [
    'CREATE UNIQUE INDEX idx_label_speech_hash ON LabelSpeech (speechHash)',
    'CREATE INDEX idx_label_speech_workspace ON LabelSpeech (WorkspaceRef)',
    'CREATE INDEX idx_label_speech_media ON LabelSpeech (MediaRef)',
  ],
});

export default LabelSpeechCollection;

// Export TypeScript types
export type LabelSpeech = z.infer<typeof LabelSpeechSchema>;
export type LabelSpeechInput = z.infer<typeof LabelSpeechInputSchema>;
export type LabelSpeechUpdate = Partial<LabelSpeechInput>;
