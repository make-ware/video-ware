import {
  defineCollection,
  RelationField,
  baseSchema,
} from 'pocketbase-zod-schema';
import { membershipCollectionPermissions } from '../utils/collection-permissions';
import { z } from 'zod';

// Define the Zod schema
export const WorkspaceMemberSchema = z
  .object({
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    UserRef: RelationField({ collection: 'Users' }),
  })
  .extend(baseSchema);

// Define input schema for creating workspace members
export const WorkspaceMemberInputSchema = z.object({
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  UserRef: z.string().min(1, 'User is required'),
});

// Define the collection with workspace-scoped permissions (update locked to
// superusers — see `membershipCollectionPermissions`).
export const WorkspaceMemberCollection = defineCollection({
  collectionName: 'WorkspaceMembers',
  schema: WorkspaceMemberSchema,
  permissions: membershipCollectionPermissions,
  indexes: [
    // Every workspace-scoped API rule in the database joins through this table
    // (`<chain>.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id`),
    // and the widened Users read rule adds a second, reverse traversal. Index both
    // orderings of the pair so either column can lead.
    //
    // UNIQUE on (WorkspaceRef, UserRef): a user belongs to a workspace once. TWO
    // columns on purpose — `dbutils.FindSingleColumnUniqueIndex` only matches
    // single-column unique indexes, and a match there would turn PocketBase's
    // multi-match resolution off and silently change what `?=` means across the
    // whole schema. NEVER add a single-column unique index on either relation.
    //
    // These strings are compared for exact equality by the migration generator, so
    // they must stay byte-identical to
    // `pb/pb_migrations/1785361300_workspace_members_indexes.js`.
    'CREATE UNIQUE INDEX idx_workspace_members_ws_user ON WorkspaceMembers (WorkspaceRef, UserRef)',
    'CREATE INDEX idx_workspace_members_user_ws ON WorkspaceMembers (UserRef, WorkspaceRef)',
  ],
});

export default WorkspaceMemberCollection;

// Export TypeScript types
export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;
export type WorkspaceMemberInput = z.infer<typeof WorkspaceMemberInputSchema>;
export type WorkspaceMemberUpdate = Partial<WorkspaceMemberInput>;
