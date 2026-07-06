import {
  defineCollection,
  RelationField,
  SelectField,
  TextField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';
import { EntityKind } from '../enums';

// A real-world identity — a person, product, place, or thing — that label
// clusters are linked to across media. Provider labels only carry generated
// ids ("speaker_0", face track ids) scoped to one media; an Entity is the
// stable workspace-level handle those clusters resolve to:
//
//   LabelTrack.EntityRef   — per-media instance link ("this face track /
//                            this diarized speaker is Erik")
//   LabelEntity.EntityRef  — workspace-wide semantic link ("every 'iPhone'
//                            object label is this product")
//
// Resolution precedence for a leaf label row: its track's EntityRef wins,
// its LabelEntity's EntityRef is the fallback.
export const EntitySchema = z
  .object({
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    name: TextField({ min: 1 }), // e.g., "Erik", "iPhone 17 Pro"
    kind: SelectField([
      EntityKind.PERSON,
      EntityKind.PRODUCT,
      EntityKind.PLACE,
      EntityKind.THING,
    ]),
    aliases: JSONField().optional(), // string[] of alternate names
    description: TextField().optional(),
    metadata: JSONField().optional(),
  })
  .extend(baseSchema);

// Define input schema for creating entities
export const EntityInputSchema = z.object({
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  name: z.string().min(1, 'Name is required'),
  kind: z.enum([
    EntityKind.PERSON,
    EntityKind.PRODUCT,
    EntityKind.PLACE,
    EntityKind.THING,
  ]),
  aliases: z.array(z.string()).optional(),
  description: z.string().optional(),
  metadata: JSONField().optional(),
});

// Define the collection with workspace-scoped permissions
export const EntityCollection = defineCollection({
  collectionName: 'Entities',
  schema: EntitySchema,
  permissions: {
    // Authenticated users can list entities
    listRule: '@request.auth.id != ""',
    // Authenticated users can view entities
    viewRule: '@request.auth.id != ""',
    // Authenticated users can create entities
    createRule: '@request.auth.id != ""',
    // Authenticated users can update entities
    updateRule: '@request.auth.id != ""',
    // Authenticated users can delete entities
    deleteRule: '@request.auth.id != ""',
  },
  indexes: [
    // One entity per (workspace, kind, name) — duplicates are merges waiting
    // to happen; disambiguate real duplicates in the name itself
    'CREATE UNIQUE INDEX idx_entities_workspace_kind_name ON Entities (WorkspaceRef, kind, name)',
    // Index for workspace + kind listings
    'CREATE INDEX idx_entities_workspace_kind ON Entities (WorkspaceRef, kind)',
  ],
});

export default EntityCollection;

// Export TypeScript types
export type Entity = z.infer<typeof EntitySchema>;
export type EntityInput = z.infer<typeof EntityInputSchema>;
export type EntityUpdate = Partial<EntityInput>;
