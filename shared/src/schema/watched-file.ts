import {
  defineCollection,
  TextField,
  NumberField,
  SelectField,
  RelationField,
  DateField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';
import { WatchedFileStatus } from '../enums';

// Define the Zod schema for tracking S3 watcher state
export const WatchedFileSchema = z
  .object({
    s3Key: TextField().min(1, 'S3 key is required'),
    s3Bucket: TextField().min(1, 'S3 bucket is required'),
    etag: TextField().optional(),
    size: NumberField({ required: true }),
    lastModified: DateField().optional(),
    status: SelectField([
      WatchedFileStatus.PENDING,
      WatchedFileStatus.PROCESSING,
      WatchedFileStatus.COMPLETED,
      WatchedFileStatus.FAILED,
      WatchedFileStatus.SKIPPED,
    ]),
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    UploadRef: RelationField({ collection: 'Uploads' }).optional(),
    errorMessage: TextField().optional(),
    processedAt: DateField().optional(),
  })
  .extend(baseSchema);

// Define input schema for creating watched files
export const WatchedFileInputSchema = z.object({
  s3Key: TextField({ min: 1 }),
  s3Bucket: TextField({ min: 1 }),
  etag: TextField().optional(),
  size: NumberField({ min: 0 }),
  lastModified: z.string().optional(),
  status: z
    .enum([
      WatchedFileStatus.PENDING,
      WatchedFileStatus.PROCESSING,
      WatchedFileStatus.COMPLETED,
      WatchedFileStatus.FAILED,
      WatchedFileStatus.SKIPPED,
    ])
    .default(WatchedFileStatus.PENDING),
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  UploadRef: z.string().optional(),
  errorMessage: TextField().optional(),
  processedAt: z.string().optional(),
});

// Define the collection with workspace-scoped permissions
export const WatchedFileCollection = defineCollection({
  collectionName: 'WatchedFiles',
  schema: WatchedFileSchema,
  permissions: {
    // Authenticated users can list watched files
    listRule: '@request.auth.id != ""',
    // Authenticated users can view watched files
    viewRule: '@request.auth.id != ""',
    // Authenticated users can create watched files
    createRule: '@request.auth.id != ""',
    // Authenticated users can update watched files
    updateRule: '@request.auth.id != ""',
    // Authenticated users can delete watched files
    deleteRule: '@request.auth.id != ""',
  },
});

export default WatchedFileCollection;

// Export TypeScript types
export type WatchedFile = z.infer<typeof WatchedFileSchema>;
export type WatchedFileInput = z.infer<typeof WatchedFileInputSchema>;
export type WatchedFileUpdate = Partial<WatchedFileInput>;
