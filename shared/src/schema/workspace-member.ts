import {
  defineCollection,
  RelationField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
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
  permissions: {
    // Users can list members of workspaces they belong to
    listRule: '@request.auth.id != ""',
    // Users can view members of workspaces they belong to
    viewRule: '@request.auth.id != ""',
    // Users can add members
    createRule: '@request.auth.id != ""',
    // Users can update their own member roles
    updateRule: '@request.auth.id != ""',
    // Users can remove themselves from workspaces
    deleteRule: '@request.auth.id != ""',
  },
});

export default WorkspaceMemberCollection;

// Export TypeScript types
export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;
export type WorkspaceMemberInput = z.infer<typeof WorkspaceMemberInputSchema>;
export type WorkspaceMemberUpdate = Partial<WorkspaceMemberInput>;
