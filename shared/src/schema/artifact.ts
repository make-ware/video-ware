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
import { ArtifactReason, ArtifactStatus, FileSource } from '../enums';

// Artifacts is a durable deletion queue (tombstones) for storage blobs that
// outlive their owning record. PocketBase's cascadeDelete removes File *records*
// and PB-native blobs, but never the external blob behind `Files.storageKey`
// (S3/GCS, or a local-backend key). A PB delete hook records each such blob here
// when its File is deleted, and the `cleanup` worker task drains the queue
// by deleting the blob via the shared StorageBackend.
export const ArtifactSchema = z
  .object({
    // Path/key in the storage backend (e.g. "uploads/{ws}/{id}/PROXY/...").
    storageKey: TextField(),
    // Which backend the blob lives on; mirrors Files.fileSource.
    fileSource: SelectField(
      [FileSource.S3, FileSource.POCKETBASE, FileSource.GCS],
      { maxSelect: 1 }
    ),
    status: SelectField(
      [ArtifactStatus.PENDING, ArtifactStatus.DELETED, ArtifactStatus.FAILED],
      { maxSelect: 1 }
    ),
    reason: TextField().optional(),
    // Provenance, for debugging (e.g. sourceCollection='Files', sourceId=<id>).
    sourceCollection: TextField().optional(),
    sourceId: TextField().optional(),
    // Number of reap attempts; bumped each time deletion fails.
    attempts: NumberField({ min: 0 }).default(0),
    errorLog: TextField().optional(),
    WorkspaceRef: RelationField({ collection: 'Workspaces' }).optional(),
  })
  .extend(baseSchema);

// Define input schema for creating artifacts
export const ArtifactInputSchema = z.object({
  storageKey: z.string().min(1, 'storageKey is required'),
  fileSource: z.enum([FileSource.S3, FileSource.POCKETBASE, FileSource.GCS]),
  status: z
    .enum([
      ArtifactStatus.PENDING,
      ArtifactStatus.DELETED,
      ArtifactStatus.FAILED,
    ])
    .default(ArtifactStatus.PENDING),
  reason: z
    .enum([
      ArtifactReason.FILE_DELETED,
      ArtifactReason.UPLOAD_DELETED,
      ArtifactReason.TASK_FAILED,
      ArtifactReason.TASK_CANCELED,
      ArtifactReason.RENDER_DELETED,
    ])
    .optional(),
  sourceCollection: TextField().optional(),
  sourceId: TextField().optional(),
  attempts: NumberField({ min: 0 }).default(0).optional(),
  errorLog: TextField().optional(),
  WorkspaceRef: z.string().optional(),
});

// Define the collection. Only superusers (the worker + PB hooks) write here;
// authenticated users may read for debugging.
export const ArtifactCollection = defineCollection({
  collectionName: 'Artifacts',
  schema: ArtifactSchema,
  permissions: superuserWriteWorkspaceReadPermissions,
});

export default ArtifactCollection;

// Export TypeScript types
export type Artifact = z.infer<typeof ArtifactSchema>;
export type ArtifactInput = z.infer<typeof ArtifactInputSchema>;
export type ArtifactUpdate = Partial<ArtifactInput>;
