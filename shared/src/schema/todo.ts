import {
  defineCollection,
  TextField,
  BoolField,
  RelationField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';

// Define the Zod schema
export const TodoSchema = z
  .object({
    title: TextField().min(1, 'Title is required').max(200, 'Title too long'),
    description: TextField().max(1000, 'Description too long').optional(),
    completed: BoolField().default(false),
    user: RelationField({ collection: 'Users' }),
  })
  .extend(baseSchema);

// Define input schema for creating todos (excludes user, which is set automatically)
export const TodoInputSchema = z.object({
  title: TextField().min(1, 'Title is required').max(200, 'Title too long'),
  description: TextField().max(1000, 'Description too long').optional(),
  completed: BoolField().default(false),
});

// Define the collection with permissions
export const TodoCollection = defineCollection({
  collectionName: 'Todos',
  schema: TodoSchema,
  permissions: {
    // Users can only list their own todos
    listRule: '@request.auth.id != "" && user = @request.auth.id',
    // Users can only view their own todos
    viewRule: '@request.auth.id != "" && user = @request.auth.id',
    // Authenticated users can create todos (user field will be set automatically)
    createRule: '@request.auth.id != "" && user = @request.auth.id',
    // Users can only update their own todos
    updateRule: '@request.auth.id != "" && user = @request.auth.id',
    // Users can only delete their own todos
    deleteRule: '@request.auth.id != "" && user = @request.auth.id',
  },
});

export default TodoCollection;

// Export TypeScript types
export type Todo = z.infer<typeof TodoSchema>;
export type TodoInput = z.infer<typeof TodoInputSchema>;
export type TodoUpdate = Partial<TodoInput>;
