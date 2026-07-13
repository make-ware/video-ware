import {
  defineCollection,
  RelationField,
  SelectField,
  TextField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { workspaceScopedPermissions } from '../utils/collection-permissions';
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
      LabelType.SPEAKER,
      LabelType.FACE,
      LabelType.SEGMENT,
      LabelType.TEXT,
    ]),
    canonicalName: TextField({ min: 1 }), // e.g., "Car", "Person", "Interview", "Wilderness"
    provider: SelectField([
      ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
      ProcessingProvider.GOOGLE_SPEECH,
      ProcessingProvider.ELEVENLABS,
    ]),
    processor: TextField(), // e.g., "object-tracking:1.0.0"
    metadata: JSONField().optional(), // Provider-specific data
    entityHash: TextField({ min: 1 }), // Unique constraint for deduplication
    // Manual link to a real-world Entity ("every label in this cluster is
    // this product/person"). Workspace-wide semantic identity — a track-level
    // LabelTrack.EntityRef takes precedence over this fallback.
    EntityRef: RelationField({ collection: 'Entities' }).optional(),
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
    LabelType.SPEAKER,
    LabelType.FACE,
    LabelType.SEGMENT,
    LabelType.TEXT,
  ]),
  canonicalName: z.string().min(1, 'Canonical name is required'),
  provider: z.enum([
    ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
    ProcessingProvider.GOOGLE_SPEECH,
    ProcessingProvider.ELEVENLABS,
  ]),
  processor: z.string().min(1, 'Processor is required'),
  metadata: JSONField().optional(),
  entityHash: z.string().min(1, 'Entity hash is required'),
  EntityRef: z.string().optional(),
});

// Define the collection with workspace-scoped permissions
export const LabelEntityCollection = defineCollection({
  collectionName: 'LabelEntity',
  schema: LabelEntitySchema,
  permissions: workspaceScopedPermissions(),
  indexes: [
    // Unique constraint on entityHash for deduplication
    'CREATE UNIQUE INDEX idx_label_entity_hash ON LabelEntity (entityHash)',
    // Index for workspace + labelType queries
    'CREATE INDEX idx_label_entity_workspace_type ON LabelEntity (WorkspaceRef, labelType)',
    // Index for canonicalName searches
    'CREATE INDEX idx_label_entity_canonical_name ON LabelEntity (canonicalName)',
    // Index for entity queries ("all label clusters linked to this entity")
    'CREATE INDEX idx_label_entity_entity ON LabelEntity (EntityRef)',
  ],
});

export default LabelEntityCollection;

// Export TypeScript types
export type LabelEntity = z.infer<typeof LabelEntitySchema>;
export type LabelEntityInput = z.infer<typeof LabelEntityInputSchema>;
export type LabelEntityUpdate = Partial<LabelEntityInput>;
