import {
  defineCollection,
  TextField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { workspacesCollectionPermissions } from '../utils/collection-permissions';
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
  permissions: workspacesCollectionPermissions,
});

export default WorkspaceCollection;

// Export TypeScript types
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type WorkspaceInput = z.infer<typeof WorkspaceInputSchema>;
export type WorkspaceUpdate = Partial<WorkspaceInput>;
