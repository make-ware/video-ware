import {
  defineCollection,
  RelationField,
  SelectField,
  TextField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';
import { LabelType, ProcessingProvider } from '../enums';

// Define the Zod schema for LabelEntity
export const LabelEntitySchema = z
  .object({
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    labelType: SelectField([
      LabelType.OBJECT,
      LabelType.SHOT,
      LabelType.PERSON,
      LabelType.SPEECH,
      LabelType.FACE,
      LabelType.SEGMENT,
      LabelType.TEXT,
    ]),
    canonicalName: TextField({ min: 1 }), // e.g., "Car", "Person", "Interview", "Wilderness"
    provider: SelectField([
      ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
      ProcessingProvider.GOOGLE_SPEECH,
    ]),
    processor: TextField(), // e.g., "object-tracking:1.0.0"
    metadata: JSONField().optional(), // Provider-specific data
    entityHash: TextField({ min: 1 }), // Unique constraint for deduplication
  })
  .extend(baseSchema);

// Define input schema for creating label entities
export const LabelEntityInputSchema = z.object({
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  labelType: z.enum([
    LabelType.OBJECT,
    LabelType.SHOT,
    LabelType.PERSON,
    LabelType.SPEECH,
    LabelType.FACE,
    LabelType.SEGMENT,
    LabelType.TEXT,
  ]),
  canonicalName: z.string().min(1, 'Canonical name is required'),
  provider: z.enum([
    ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
    ProcessingProvider.GOOGLE_SPEECH,
  ]),
  processor: z.string().min(1, 'Processor is required'),
  metadata: JSONField().optional(),
  entityHash: z.string().min(1, 'Entity hash is required'),
});

// Define the collection with workspace-scoped permissions
export const LabelEntityCollection = defineCollection({
  collectionName: 'LabelEntity',
  schema: LabelEntitySchema,
  permissions: {
    // Authenticated users can list label entities
    listRule: '@request.auth.id != ""',
    // Authenticated users can view label entities
    viewRule: '@request.auth.id != ""',
    // Authenticated users can create label entities
    createRule: '@request.auth.id != ""',
    // Authenticated users can update label entities
    updateRule: '@request.auth.id != ""',
    // Authenticated users can delete label entities
    deleteRule: '@request.auth.id != ""',
  },
  indexes: [
    // Unique constraint on entityHash for deduplication
    'CREATE UNIQUE INDEX idx_label_entity_hash ON LabelEntity (entityHash)',
    // Index for workspace + labelType queries
    'CREATE INDEX idx_label_entity_workspace_type ON LabelEntity (WorkspaceRef, labelType)',
    // Index for canonicalName searches
    'CREATE INDEX idx_label_entity_canonical_name ON LabelEntity (canonicalName)',
  ],
});

export default LabelEntityCollection;

// Export TypeScript types
export type LabelEntity = z.infer<typeof LabelEntitySchema>;
export type LabelEntityInput = z.infer<typeof LabelEntityInputSchema>;
export type LabelEntityUpdate = Partial<LabelEntityInput>;
