import {
  defineCollection,
  RelationField,
  TextField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { workspaceScopedPermissions } from '../utils/collection-permissions';
import { z } from 'zod';
import type { Workspace } from './workspace';

/**
 * Path-safe directory names: letters, digits, dashes, and underscores only
 * (no spaces or symbols), starting with a letter or digit. Directories are
 * flat — one level, unique names per workspace (case-insensitive), enforced
 * by the unique index on DirectoryCollection below and the name-field
 * pattern.
 */
export const DIRECTORY_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
export const DIRECTORY_NAME_MAX = 60;
export const DIRECTORY_NAME_RULE =
  'letters, digits, dashes, and underscores only, starting with a letter or digit';

/** Human-readable reason a proposed directory name is invalid, or null. */
export function directoryNameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Name is required';
  if (trimmed.length > DIRECTORY_NAME_MAX) {
    return `Name must be at most ${DIRECTORY_NAME_MAX} characters`;
  }
  if (!DIRECTORY_NAME_PATTERN.test(trimmed)) {
    return `Directory names allow ${DIRECTORY_NAME_RULE}`;
  }
  return null;
}

/** Reusable name rule for create/rename inputs. */
export const DirectoryNameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(
    DIRECTORY_NAME_MAX,
    `Name must be at most ${DIRECTORY_NAME_MAX} characters`
  )
  .regex(
    DIRECTORY_NAME_PATTERN,
    `Directory names allow ${DIRECTORY_NAME_RULE}`
  );

// Define the Zod schema
export const DirectorySchema = z
  .object({
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    // Mirrors the DB-level constraints the flatten_Directories migration set.
    // `pattern` must be the string source, not the RegExp: field options are
    // JSON.stringify'd into the schema metadata, and a RegExp serializes to {}.
    name: TextField({
      max: DIRECTORY_NAME_MAX,
      pattern: DIRECTORY_NAME_PATTERN.source,
    }),
  })
  .extend(baseSchema);

// Define input schema for creating directories
export const DirectoryInputSchema = z.object({
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  name: DirectoryNameSchema,
});

// Define the collection with workspace-scoped permissions
export const DirectoryCollection = defineCollection({
  collectionName: 'Directories',
  schema: DirectorySchema,
  permissions: workspaceScopedPermissions(),
  indexes: [
    // One directory name per workspace, case-insensitive — "Raw" and "raw"
    // collide, so a path built from either name resolves to one directory.
    'CREATE UNIQUE INDEX idx_directories_workspace_name ON Directories (WorkspaceRef, name COLLATE NOCASE)',
  ],
});

export default DirectoryCollection;

// Export TypeScript types
export type Directory = Omit<z.infer<typeof DirectorySchema>, 'expand'>;
export type DirectoryInput = z.infer<typeof DirectoryInputSchema>;
export type DirectoryUpdate = Partial<DirectoryInput>;

export interface DirectoryRelations {
  WorkspaceRef: Workspace;
}
