import {
  defineCollection,
  RelationField,
  TextField,
  NumberField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';

// Word timing structure for diarized STT providers (e.g. ElevenLabs Scribe).
// Times are float seconds; speakerId is the provider's identifier for the
// speaker (e.g. "speaker_0"). Validates the content inside the JSONField.
const SpeakerWordTimingSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
  speakerId: z.string().optional(),
});

export const LabelSpeakerSchema = z
  .object({
    // --- Relations ---
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    MediaRef: RelationField({ collection: 'Media' }),
    LabelTrackRef: RelationField({ collection: 'LabelTrack' }).optional(),
    LabelEntityRef: RelationField({ collection: 'LabelEntity' }).optional(),

    // --- Content ---
    transcript: TextField({ min: 1 }),
    languageCode: TextField().optional(), // e.g. "en"

    // --- Timing (Standardized) ---
    start: NumberField({ min: 0 }),
    end: NumberField({ min: 0 }),
    duration: NumberField({ min: 0 }),

    // --- Details ---
    speakerId: TextField({ min: 1 }), // Provider speaker id (e.g. "speaker_0")
    words: JSONField(), // Stores array of SpeakerWordTimingSchema

    // --- Metadata ---
    confidence: NumberField({ min: 0, max: 1 }),
    metadata: JSONField().optional(),
    speakerHash: TextField({ min: 1 }), // Unique constraint
  })
  .extend(baseSchema);

// Define input schema for creating label speaker utterances
export const LabelSpeakerInputSchema = z.object({
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  MediaRef: z.string().min(1, 'Media is required'),
  LabelEntityRef: z.string().optional(),
  LabelTrackRef: z.string().optional(),

  transcript: z.string().min(1, 'Transcript is required'),
  start: z.number().min(0),
  end: z.number().min(0),
  duration: z.number().min(0),
  confidence: z.number().min(0).max(1),

  speakerId: z.string().min(1, 'Speaker id is required'),
  languageCode: z.string().optional(),

  words: z.array(SpeakerWordTimingSchema),

  metadata: JSONField().optional(),
  speakerHash: z.string().min(1, 'Speaker hash is required'),
});

// Define the collection
export const LabelSpeakerCollection = defineCollection({
  collectionName: 'LabelSpeaker',
  schema: LabelSpeakerSchema,
  permissions: {
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
  },
  indexes: [
    'CREATE UNIQUE INDEX idx_label_speaker_hash ON LabelSpeaker (speakerHash)',
    'CREATE INDEX idx_label_speaker_workspace ON LabelSpeaker (WorkspaceRef)',
    'CREATE INDEX idx_label_speaker_media ON LabelSpeaker (MediaRef)',
    // Media-scoped time-overlap lookups (mirrors idx_label_speech_media_range).
    'CREATE INDEX idx_label_speaker_media_range ON LabelSpeaker (MediaRef, start, "end")',
    // Per-speaker filtering within a media (Q&A editing workflows).
    'CREATE INDEX idx_label_speaker_media_speaker ON LabelSpeaker (MediaRef, speakerId)',
    // Entity-attribution joins ("everything Erik said" traverses these).
    'CREATE INDEX idx_label_speaker_track ON LabelSpeaker (LabelTrackRef)',
    'CREATE INDEX idx_label_speaker_entity ON LabelSpeaker (LabelEntityRef)',
  ],
});

export default LabelSpeakerCollection;

// Export TypeScript types
export type LabelSpeaker = z.infer<typeof LabelSpeakerSchema>;
export type LabelSpeakerInput = z.infer<typeof LabelSpeakerInputSchema>;
export type LabelSpeakerUpdate = Partial<LabelSpeakerInput>;
