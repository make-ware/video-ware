import {
  defineCollection,
  RelationField,
  TextField,
  NumberField,
  JSONField,
  baseSchema,
  SelectField,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';
import { LabelType } from '../enums';

// Define the Zod schema for LabelShot
export const LabelSegmentSchema = z
  .object({
    // --- Relations ---
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    MediaRef: RelationField({ collection: 'Media' }),
    LabelEntityRef: RelationField({ collection: 'LabelEntity' }).optional(),
    labelType: SelectField([
      LabelType.SEGMENT,
      LabelType.OBJECT,
      LabelType.PERSON,
      LabelType.FACE,
    ]),

    // --- Identification ---
    // The text label (e.g., "wilderness", "outdoor recreation")
    entity: TextField(),
    // Unique constraint (e.g., hash of mediaId + entity + start + end)
    segmentHash: TextField({ min: 1 }),

    // --- Timing & Confidence ---
    start: NumberField({ min: 0 }), // seconds (from segments[].startTime)
    end: NumberField({ min: 0 }), // seconds (from segments[].endTime)
    duration: NumberField({ min: 0 }), // end - start

    // Use the confidence from the specific segment object
    confidence: NumberField({ min: 0, max: 1 }),

    // --- Metadata ---
    version: NumberField().default(1).optional(),
    metadata: JSONField(),
  })
  .extend(baseSchema);

// Define input schema for creating label segments
export const LabelSegmentInputSchema = z.object({
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  MediaRef: z.string().min(1, 'Media is required'),
  LabelEntityRef: z.string().optional(),
  labelType: z.enum([
    LabelType.SEGMENT,
    LabelType.OBJECT,
    LabelType.PERSON,
    LabelType.FACE,
  ]),
  entity: z.string(),
  segmentHash: z.string().min(1, 'Segment hash is required'),
  start: z.number().min(0),
  end: z.number().min(0),
  duration: z.number().min(0),
  confidence: z.number().min(0).max(1),
  metadata: JSONField(),
  version: z.number().optional(),
});

// Define the collection
export const LabelSegmentCollection = defineCollection({
  collectionName: 'LabelSegments',
  schema: LabelSegmentSchema,
  permissions: {
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
  },
  indexes: [
    'CREATE UNIQUE INDEX idx_label_segment_hash ON LabelSegment (segmentHash)',
    'CREATE INDEX idx_label_segment_workspace ON LabelSegment (WorkspaceRef)',
    'CREATE INDEX idx_label_segment_media ON LabelSegment (MediaRef)',
    'CREATE INDEX idx_label_segment_entity ON LabelSegment (LabelEntityRef)',
  ],
});

export default LabelSegmentCollection;

// Export TypeScript types
export type LabelSegment = z.infer<typeof LabelSegmentSchema>;
export type LabelSegmentInput = z.infer<typeof LabelSegmentInputSchema>;
export type LabelSegmentUpdate = Partial<LabelSegmentInput>;
