import {
  baseSchema,
  defineCollection,
  EmailField,
  FileField,
  TextField,
} from 'pocketbase-zod-schema';
import { usersCollectionPermissions } from '../utils/collection-permissions';
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
//
// Permissions come from `collection-permissions.ts` (the source of truth every
// other collection already imports) rather than being spelled out here: reads are
// widened to co-members so a workspace member list can resolve `expand=UserRef`,
// while writes stay self-only. See `usersCollectionPermissions` for the full
// reasoning and `pb/pb_migrations/1785361310_widen_Users_read_to_comembers.js`.
//
// `emailVisibility` is deliberately absent from `UserSchema`: it is a PocketBase
// auth system field that already exists on the collection, and `defineCollection`
// never sets `type` here, so the generator treats `Users` as a base collection and
// would try to CREATE the field. It is set server-side instead, by
// `pb/pb_hooks/hook-users-email-visibility.pb.js`, which covers every create path.
export const UserCollection = defineCollection({
  collectionName: 'Users',
  schema: UserSchema,
  permissions: usersCollectionPermissions,
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
