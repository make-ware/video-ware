import {
  defineCollection,
  TextField,
  NumberField,
  SelectField,
  RelationField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { superuserWriteWorkspaceReadPermissions } from '../utils/collection-permissions';
import { z } from 'zod';
import { WatchFolderImportStatus } from '../enums';

// WatchFolderImports is the append-only ledger for the worker's S3
// watch-folder importer: one row per attempted (key, etag) pair. The DB
// unique index on (key, etag) doubles as the atomic claim between concurrent
// workers, and a row existing at all — any status — burns the pair forever:
// the watcher never reattempts an import it has a row for, even after a
// failure or a byte-identical re-upload. Renaming/moving the S3 object (a
// new key) is the only way to get a fresh attempt.
export const WatchFolderImportSchema = z
  .object({
    // Full S3 object key, e.g. "import/{workspaceId}/{dir}/clip.mp4".
    key: TextField(),
    // S3 ETag with surrounding quotes stripped (as listFiles returns it).
    etag: TextField(),
    // Object size in bytes at claim time.
    size: NumberField({ min: 0 }).optional(),
    status: SelectField(
      [
        WatchFolderImportStatus.IMPORTING,
        WatchFolderImportStatus.IMPORTED,
        WatchFolderImportStatus.FAILED,
        WatchFolderImportStatus.SKIPPED,
      ],
      { maxSelect: 1 }
    ),
    // Failure/skip reason, for operators (truncated to 500 chars).
    error: TextField().optional(),
    // The Upload the import produced. No cascade: deleting the Upload must
    // not un-burn the ledger row.
    UploadRef: RelationField({ collection: 'Uploads' }).optional(),
    // Blank for structural rejects that never resolved a workspace
    // (e.g. a file dropped at the import root).
    WorkspaceRef: RelationField({ collection: 'Workspaces' }).optional(),
  })
  .extend(baseSchema);

// Define input schema for creating watch-folder import rows
export const WatchFolderImportInputSchema = z.object({
  key: z.string().min(1, 'key is required'),
  etag: z.string().min(1, 'etag is required'),
  size: z.number().min(0).optional(),
  status: z.enum([
    WatchFolderImportStatus.IMPORTING,
    WatchFolderImportStatus.IMPORTED,
    WatchFolderImportStatus.FAILED,
    WatchFolderImportStatus.SKIPPED,
  ]),
  error: z.string().optional(),
  UploadRef: z.string().optional(),
  WorkspaceRef: z.string().optional(),
});

// Define the collection. Only superusers (the worker) write here;
// workspace members may read rows scoped to their workspace.
export const WatchFolderImportCollection = defineCollection({
  collectionName: 'WatchFolderImports',
  schema: WatchFolderImportSchema,
  permissions: superuserWriteWorkspaceReadPermissions,
});

export default WatchFolderImportCollection;

// Export TypeScript types
export type WatchFolderImport = z.infer<typeof WatchFolderImportSchema>;
export type WatchFolderImportInput = z.infer<
  typeof WatchFolderImportInputSchema
>;
export type WatchFolderImportUpdate = Partial<WatchFolderImportInput>;
