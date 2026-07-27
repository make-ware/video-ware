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
import { EntityKind } from '../enums';

// A real-world identity — a person, product, place, or thing — that detected
// labels are linked to across media. Provider labels only carry generated ids
// ("speaker_0", face track ids) scoped to one media; an Entity is the stable
// workspace-level handle they resolve to, through exactly one field:
//
//   LabelEntity.EntityRef — "this detected instance, in this media, is Erik"
//
// One link point, one hop: a leaf label row resolves its entity through its
// LabelEntityRef, and so does a LabelTrack. (LabelTrack.EntityRef predates
// per-media LabelEntity rows and is retired — see the schema note there.)
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

// The editable subset, for patching an existing entity. WorkspaceRef is
// omitted deliberately: an entity never moves workspaces, and the unique
// index is scoped by it. `.partial()` keeps each field's validator, so an
// omitted `name` is fine but `name: ''` is still rejected.
export const EntityPatchSchema = EntityInputSchema.omit({
  WorkspaceRef: true,
}).partial();

// Define the collection with workspace-scoped permissions
export const EntityCollection = defineCollection({
  collectionName: 'Entities',
  schema: EntitySchema,
  permissions: workspaceScopedPermissions(),
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
export type EntityPatch = z.infer<typeof EntityPatchSchema>;
export type EntityUpdate = Partial<EntityInput>;
