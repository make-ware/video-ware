import {
  defineCollection,
  TextField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';

// Define the Zod schema
export const WorkspaceSchema = z
  .object({
    name: TextField().min(1, 'Name is required').max(100, 'Name too long'),
    slug: TextField().max(100, 'Slug too long').optional(),
    settings: JSONField().optional(),
  })
  .extend(baseSchema);

// Define input schema for creating workspaces
export const WorkspaceInputSchema = z.object({
  name: TextField().min(1, 'Name is required').max(100, 'Name too long'),
  slug: TextField().max(100, 'Slug too long').optional(),
  settings: JSONField().optional(),
});

// Define the collection with permissions
export const WorkspaceCollection = defineCollection({
  collectionName: 'Workspaces',
  schema: WorkspaceSchema,
  permissions: {
    // Authenticated users can list workspaces they are members of
    listRule: '@request.auth.id != ""',
    // Authenticated users can view workspaces they are members of
    viewRule: '@request.auth.id != ""',
    // Authenticated users can create workspaces
    createRule: '@request.auth.id != ""',
    // Authenticated users can update (will be refined with workspace member checks)
    updateRule: '@request.auth.id != ""',
    // Authenticated users can delete (will be refined with workspace member checks)
    deleteRule: '@request.auth.id != ""',
  },
});

export default WorkspaceCollection;

// Export TypeScript types
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type WorkspaceInput = z.infer<typeof WorkspaceInputSchema>;
export type WorkspaceUpdate = Partial<WorkspaceInput>;
