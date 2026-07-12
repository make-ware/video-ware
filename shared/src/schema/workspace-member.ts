import {
  defineCollection,
  RelationField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { workspaceScopedPermissions } from '../utils/collection-permissions';
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

// Define the collection with workspace-scoped permissions
export const WorkspaceMemberCollection = defineCollection({
  collectionName: 'WorkspaceMembers',
  schema: WorkspaceMemberSchema,
  permissions: workspaceScopedPermissions(),
});

export default WorkspaceMemberCollection;

// Export TypeScript types
export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;
export type WorkspaceMemberInput = z.infer<typeof WorkspaceMemberInputSchema>;
export type WorkspaceMemberUpdate = Partial<WorkspaceMemberInput>;
