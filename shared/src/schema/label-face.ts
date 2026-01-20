import {
  defineCollection,
  RelationField,
  TextField,
  NumberField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';

// Define the Zod schema for LabelFace
export const LabelFaceSchema = z
  .object({
    // --- Relations ---
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    MediaRef: RelationField({ collection: 'Media' }),
    LabelEntityRef: RelationField({ collection: 'LabelEntity' }),
    LabelTrackRef: RelationField({ collection: 'LabelTrack' }).optional(),

    // --- Identification ---
    faceId: TextField().optional(),
    faceHash: TextField({ min: 1 }),

    // --- Timing & Confidence ---
    start: NumberField({ min: 0 }),
    end: NumberField({ min: 0 }),
    duration: NumberField({ min: 0 }),
    avgConfidence: NumberField({ min: 0, max: 1 }),

    // --- Attributes (Likelihoods) ---
    // Changed to TextField to accept any string value (e.g., "VERY_LIKELY", "POSSIBLE")
    joyLikelihood: TextField().optional(),
    sorrowLikelihood: TextField().optional(),
    angerLikelihood: TextField().optional(),
    surpriseLikelihood: TextField().optional(),
    underExposedLikelihood: TextField().optional(),
    blurredLikelihood: TextField().optional(),
    headwearLikelihood: TextField().optional(),
    lookingAtCameraLikelihood: TextField().optional(),

    // Embedding Data
    embedding: JSONField().optional(),

    // 3. Model Version
    // Essential because embeddings from AWS are not compatible with Google or dlib.
    // e.g., "google-celebrity-v1", "facenet-512", "aws-rekognition-3.0"
    embeddingModel: TextField().optional(),

    // 4. Image Quality / Biometric Score
    // Used to discard blurry or bad faces before trying to match them.
    // Google doesn't give a single "quality" score, but you can derive it
    // or store it from other providers.
    qualityScore: NumberField({ min: 0, max: 1 }).optional(),

    // 5. Visual Hash (pHash)
    // A perceptual hash of the face crop. Useful for finding
    // "visually identical" face images across different video files
    // without doing full AI vector matching.
    visualHash: TextField().optional(),

    // --- Extra Data ---
    metadata: JSONField(),

    // --- System ---
    version: NumberField().default(1).optional(),
  })
  .extend(baseSchema);

// Define input schema for creating label faces
export const LabelFaceInputSchema = z.object({
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  MediaRef: z.string().min(1, 'Media is required'),
  LabelEntityRef: z.string(),
  LabelTrackRef: z.string().optional(),
  faceId: z.string().optional(),
  faceHash: z.string().min(1, 'Face hash is required'),

  start: z.number().min(0),
  end: z.number().min(0),
  duration: z.number().min(0),
  avgConfidence: z.number().min(0).max(1),

  joyLikelihood: z.string().optional(),
  sorrowLikelihood: z.string().optional(),
  angerLikelihood: z.string().optional(),
  surpriseLikelihood: z.string().optional(),
  underExposedLikelihood: z.string().optional(),
  blurredLikelihood: z.string().optional(),
  headwearLikelihood: z.string().optional(),
  lookingAtCameraLikelihood: z.string().optional(),

  embedding: z.any().optional(),
  embeddingModel: z.string().optional(),
  qualityScore: z.number().optional(),
  visualHash: z.string().optional(),

  metadata: JSONField(),
  version: z.number().optional(),
});

// Define the collection
export const LabelFaceCollection = defineCollection({
  collectionName: 'LabelFaces',
  schema: LabelFaceSchema,
  permissions: {
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
  },
  indexes: [
    'CREATE UNIQUE INDEX idx_label_face_hash ON LabelFaces (faceHash)',
    'CREATE INDEX idx_label_face_workspace ON LabelFaces (WorkspaceRef)',
    'CREATE INDEX idx_label_face_media ON LabelFaces (MediaRef)',
    'CREATE INDEX idx_label_face_track ON LabelFaces (LabelTrackRef)',
  ],
});

export default LabelFaceCollection;

// Export TypeScript types
export type LabelFace = z.infer<typeof LabelFaceSchema>;
export type LabelFaceInput = z.infer<typeof LabelFaceInputSchema>;
export type LabelFaceUpdate = Partial<LabelFaceInput>;
