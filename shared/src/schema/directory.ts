import {
  defineCollection,
  RelationField,
  TextField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';
import type { Workspace } from './workspace';

// Define the Zod schema
export const DirectorySchema = z
  .object({
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    ParentDirectoryRef: RelationField({
      collection: 'Directories',
    }).optional(),
    name: TextField(),
  })
  .extend(baseSchema);

// Define input schema for creating directories
export const DirectoryInputSchema = z.object({
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  ParentDirectoryRef: z.string().optional(),
  name: z.string().min(1, 'Name is required'),
});

// Define the collection with workspace-scoped permissions
export const DirectoryCollection = defineCollection({
  collectionName: 'Directories',
  schema: DirectorySchema,
  permissions: {
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
  },
});

export default DirectoryCollection;

// Export TypeScript types
export type Directory = Omit<z.infer<typeof DirectorySchema>, 'expand'>;
export type DirectoryInput = z.infer<typeof DirectoryInputSchema>;
export type DirectoryUpdate = Partial<DirectoryInput>;

export interface DirectoryRelations {
  WorkspaceRef: Workspace;
  ParentDirectoryRef?: Directory;
}
