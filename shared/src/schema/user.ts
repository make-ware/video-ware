import {
  baseSchema,
  defineCollection,
  EmailField,
  FileField,
  TextField,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';

// Define the Zod schema
// This will be an auth collection since it has email and password
export const UserSchema = z
  .object({
    name: TextField({ min: 0, max: 255 }).optional(),
    email: EmailField(),
    password: TextField().min(8, 'Password must be at least 8 characters'),
    avatar: FileField({
      mimeTypes: [
        'image/jpeg',
        'image/png',
        'image/svg+xml',
        'image/gif',
        'image/webp',
      ],
    }).optional(),
  })
  .extend(baseSchema);

// Define the collection with permissions
// Note: Indexes for auth collections (tokenKey, email) are automatically managed by PocketBase
export const UserCollection = defineCollection({
  collectionName: 'Users',
  schema: UserSchema,
  permissions: {
    // Users can list profiles
    listRule: 'id = @request.auth.id',
    // Users can view profiles
    viewRule: 'id = @request.auth.id',
    // Anyone can create an account (sign up)
    createRule: '',
    // Users can only update their own profile
    updateRule: 'id = @request.auth.id',
    // Users can only delete their own account
    deleteRule: 'id = @request.auth.id',
    // manageRule is null in PocketBase default (not set)
  },
  indexes: [
    // PocketBase's default indexes for auth collections
    'CREATE UNIQUE INDEX `idx_tokenKey__pb_users_auth_` ON `users` (`tokenKey`)',
    "CREATE UNIQUE INDEX `idx_email__pb_users_auth_` ON `users` (`email`) WHERE `email` != ''",
  ],
});

export default UserCollection;

// Define the Zod schema for user input (includes passwordConfirm for validation)
export const UserInputSchema = z
  .object({
    name: TextField({ max: 255 }).optional(),
    email: TextField(), // Email validation handled by PocketBase
    password: TextField({ min: 8 }),
    passwordConfirm: z.string(),
    avatar: FileField().optional(),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: "Passwords don't match",
    path: ['passwordConfirm'],
  });

// Login schema for authentication
export const LoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

// Register schema for user registration
export const RegisterSchema = z
  .object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    passwordConfirm: z.string().min(1, 'Password confirmation is required'),
    name: z.string().max(255).optional(),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: "Passwords don't match",
    path: ['passwordConfirm'],
  });

// Export types
export type UserInput = z.infer<typeof UserInputSchema>;
export type User = z.infer<typeof UserSchema>;
export type LoginData = z.infer<typeof LoginSchema>;
export type RegisterData = z.infer<typeof RegisterSchema>;
