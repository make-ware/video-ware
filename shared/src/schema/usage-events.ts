import {
  // defineCollection,
  TextField,
  NumberField,
  RelationField,
  JSONField,
  baseSchema,
  defineCollection,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';

// Define the Zod schema
export const UsageEventSchema = z
  .object({
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    type: TextField(), // e.g., 'GOOGLE_VIDEO', 'FFMPEG_COMPUTE', 'STORAGE'
    subtype: TextField(), // e.g., 'LABEL_DETECTION', 'TRANSCODE', 'S3'
    value: NumberField(), // duration in seconds, or bytes
    unit: TextField(), // 'SECONDS', 'BYTES', 'COUNT'
    metadata: JSONField().optional(),
  })
  .extend(baseSchema);

// Define input schema
export const UsageEventInputSchema = z.object({
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  type: z.string().min(1, 'Type is required'),
  subtype: z.string().min(1, 'Subtype is required'),
  value: z.number(),
  unit: z.string().min(1, 'Unit is required'),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// Define the collection
// Skipping defineCollection due to build issues
export const UsageEventCollection = defineCollection({
  collectionName: 'UsageEvents',
  schema: UsageEventSchema,
  permissions: {
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
  },
});

export default UsageEventCollection;

// Export TypeScript types
export type UsageEvent = z.infer<typeof UsageEventSchema>;
export type UsageEventInput = z.infer<typeof UsageEventInputSchema>;
