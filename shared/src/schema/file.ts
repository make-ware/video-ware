import {
  defineCollection,
  TextField,
  NumberField,
  SelectField,
  FileField,
  RelationField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';
import { FileStatus, FileType, FileSource } from '../enums';
import { FileMetaSchema } from '../types/metadata';

// Define the Zod schema
export const FileSchema = z
  .object({
    name: TextField(),
    size: NumberField({ required: true }),
    fileStatus: SelectField(
      [
        FileStatus.PENDING,
        FileStatus.AVAILABLE,
        FileStatus.FAILED,
        FileStatus.DELETED,
      ],
      { maxSelect: 1 }
    ),
    fileType: SelectField([
      FileType.ORIGINAL,
      FileType.PROXY,
      FileType.AUDIO,
      FileType.THUMBNAIL,
      FileType.SPRITE,
      FileType.LABELS_JSON,
      FileType.RENDER,
      FileType.FILMSTRIP,
    ]),
    fileSource: SelectField([
      FileSource.S3,
      FileSource.POCKETBASE,
      FileSource.GCS,
    ]),
    file: FileField({ maxSize: 7000000000 }).optional(),
    s3Key: TextField().optional(),
    meta: JSONField(FileMetaSchema).optional(),
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    UploadRef: RelationField({ collection: 'Uploads' }).optional(),
    MediaRef: RelationField({ collection: 'Media' }).optional(),
  })
  .extend(baseSchema);

// Define input schema for creating files
export const FileInputSchema = z.object({
  name: TextField(),
  size: NumberField(),
  fileStatus: z
    .enum([
      FileStatus.PENDING,
      FileStatus.AVAILABLE,
      FileStatus.FAILED,
      FileStatus.DELETED,
    ])
    .default(FileStatus.PENDING),
  fileType: z.enum([
    FileType.ORIGINAL,
    FileType.PROXY,
    FileType.AUDIO,
    FileType.THUMBNAIL,
    FileType.SPRITE,
    FileType.LABELS_JSON,
    FileType.RENDER,
  ]),
  fileSource: z.enum([FileSource.S3, FileSource.POCKETBASE, FileSource.GCS]),
  file: z.instanceof(File).optional(),
  s3Key: TextField().optional(),
  meta: JSONField(FileMetaSchema).optional(),
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  UploadRef: z.string().optional(),
  MediaRef: z.string().optional(),
});

// Define the collection with workspace-scoped permissions
export const FileCollection = defineCollection({
  collectionName: 'Files',
  schema: FileSchema,
  permissions: {
    // Authenticated users can list files
    listRule: '@request.auth.id != ""',
    // Authenticated users can view files
    viewRule: '@request.auth.id != ""',
    // Authenticated users can create files
    createRule: '@request.auth.id != ""',
    // Authenticated users can update files
    updateRule: '@request.auth.id != ""',
    // Authenticated users can delete files
    deleteRule: '@request.auth.id != ""',
  },
});

export default FileCollection;

// Export TypeScript types
export type File = z.infer<typeof FileSchema>;
export type FileInput = z.infer<typeof FileInputSchema>;
export type FileUpdate = Partial<FileInput>;
