import {
  defineCollection,
  RelationField,
  NumberField,
  baseSchema,
  TextField,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';

// Define the Zod schema
export const LabelJobSchema = z
  .object({
    MediaRef: RelationField({ collection: 'Media' }),
    jobType: TextField(), // object, shot, person, speech, face
    TaskRef: RelationField({ collection: 'Tasks' }).optional(),
    version: NumberField().default(1),
  })
  .extend(baseSchema);

// Define input schema for creating label jobs
export const LabelJobInputSchema = z.object({
  MediaRef: z.string().min(1, 'Media is required'),
  jobType: z.string().min(1, 'Job type is required'),
  TaskRef: z.string().optional(),
  version: NumberField().default(1).optional(),
});

// Define the collection with workspace-scoped permissions
export const LabelJobCollection = defineCollection({
  collectionName: 'LabelJobs',
  schema: LabelJobSchema,
  permissions: {
    // Authenticated users can list label jobs
    listRule: '@request.auth.id != ""',
    // Authenticated users can view label jobs
    viewRule: '@request.auth.id != ""',
    // Authenticated users can create label jobs
    createRule: '@request.auth.id != ""',
    // Authenticated users can update label jobs
    updateRule: '@request.auth.id != ""',
    // Authenticated users can delete label jobs
    deleteRule: '@request.auth.id != ""',
  },
});

export default LabelJobCollection;

// Export TypeScript types
export type LabelJob = z.infer<typeof LabelJobSchema>;
export type LabelJobInput = z.infer<typeof LabelJobInputSchema>;
export type LabelJobUpdate = Partial<LabelJobInput>;
