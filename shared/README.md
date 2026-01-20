# Shared Package

This workspace contains shared types, schemas, mutators, and utilities for the Next.js + PocketBase monorepo.

## Features

- **Mutators**: Type-safe data access classes for all PocketBase operations (primary interface)
- **Zod Schemas**: Type-safe validation schemas for PocketBase collections
- **TypeScript Types**: Shared types and interfaces
- **Database Migrations**: Generate and manage PocketBase schema migrations
- **Utility Functions**: Common helper functions for validation and error handling
- **Type Generation**: Automatic TypeScript type generation from PocketBase schema

## Installation

This package is automatically installed as part of the monorepo workspace.

## Usage

### ⚠️ Important: Use Mutators for All Data Operations

**All PocketBase data operations should use mutators, not direct PocketBase SDK calls.** Mutators provide type safety, validation, and consistent error handling.

### In Next.js App

```typescript
// Import mutators and types
import { UserMutator } from '@project/shared';
import { pb } from '@/lib/pocketbase'; // Client-side PocketBase instance

// Create a mutator instance
const userMutator = new UserMutator(pb);

// Type-safe data operations
const user = await userMutator.getById('user-id');
const users = await userMutator.getList(1, 10, undefined, '-created');
const newUser = await userMutator.create({
  email: 'user@example.com',
  password: 'secure123',
  passwordConfirm: 'secure123',
});
await userMutator.update('user-id', { name: 'Updated Name' });
await userMutator.delete('user-id');

// With filters and expands
const adminUsers = await userMutator.getList(
  1,
  10,
  'role = "admin"',
  '-created',
  'profile'
);
```

### Creating New Mutators

Extend `BaseMutator` to create mutators for your collections:

```typescript
// src/mutator/postMutator.ts
import { RecordService } from 'pocketbase';
import { Post, PostInput, PostInputSchema } from '../schema/post';
import { TypedPocketBase } from '../types';
import { BaseMutator } from './baseMutator';

export class PostMutator extends BaseMutator<Post, PostInput> {
  constructor(pb: TypedPocketBase) {
    super(pb, {
      // Optional: Set default options
      expand: ['author'],
      filter: ['published = true'],
      sort: ['-created'],
    });
  }

  protected getCollection(): RecordService<Post> {
    return this.pb.collection<Post>('posts');
  }

  protected async validateInput(input: PostInput): Promise<PostInput> {
    return PostInputSchema.parse(input);
  }
}
```

### BaseMutator API

The `BaseMutator` class provides these methods:

- `create(input)` - Create a new record
- `update(id, input)` - Update an existing record
- `upsert(input)` - Create or update a record
- `getById(id, expand?)` - Get a record by ID
- `getFirstByFilter(filter, expand?, sort?)` - Get first matching record
- `getList(page, perPage, filter?, sort?, expand?)` - Get paginated list
- `delete(id)` - Delete a record
- `subscribeToRecord(id, callback, expand?)` - Subscribe to record changes
- `subscribeToCollection(callback, expand?)` - Subscribe to collection changes

### In PocketBase Hooks

```javascript
// pb/pb_hooks/main.pb.js
// Import validation schemas (when using TypeScript hooks)
const { UserSchema } = require('shared');
```

## Scripts

- `yarn build` - Compile TypeScript to JavaScript
- `yarn dev` - Watch mode compilation
- `yarn clean` - Remove build artifacts
- `yarn typegen` - Generate TypeScript types from PocketBase schema
- `yarn migrate:generate` - Generate database migration from schema changes
- `yarn migrate:status` - Check migration status

## Type Generation

To generate TypeScript types from your PocketBase collections:

1. Make sure PocketBase is running (`yarn pb:dev`)
2. Run the type generator: `yarn workspace shared typegen`
3. Types will be generated in `src/types/pocketbase.ts`

## Structure

```
shared/
├── src/
│   ├── mutator/          # Mutator classes (BaseMutator, UserMutator, etc.)
│   │   ├── baseMutator.ts    # Base mutator class
│   │   └── userMutator.ts    # Example mutator implementation
│   ├── schema/           # Collection definitions using defineCollection
│   │   ├── user.ts           # User collection schema
│   │   └── todo.ts           # Todo collection schema
│   ├── types/            # TypeScript type definitions
│   ├── utils/            # Utility functions
│   ├── pocketbase/       # PocketBase client configuration
│   └── index.ts          # Main exports
├── dist/                 # Compiled JavaScript (generated)
├── pocketbase-migrate.config.js  # Migration configuration
└── package.json
```

## Adding New Collections

When adding a new PocketBase collection, follow these steps using the `defineCollection` pattern:

1. **Create the schema** in `src/schema/`:

```typescript
// src/schema/post.ts
import { z } from 'zod';
import {
  defineCollection,
  TextField,
  RelationField,
  BoolField,
  baseSchema,
} from 'pocketbase-zod-schema';

// Define the Zod schema using field helpers
export const PostSchema = z
  .object({
    title: TextField().min(1, 'Title is required').max(200, 'Title too long'),
    content: TextField().min(1, 'Content is required'),
    author: RelationField({ collection: 'Users' }),
    published: BoolField().default(false),
  })
  .extend(baseSchema); // Adds id, created, updated fields

export type Post = z.infer<typeof PostSchema>;

// Define input schema for creating/updating posts
export const PostInputSchema = z.object({
  title: TextField().min(1, 'Title is required').max(200, 'Title too long'),
  content: TextField().min(1, 'Content is required'),
  author: RelationField({ collection: 'Users' }),
  published: BoolField().default(false),
});

export type PostInput = z.infer<typeof PostInputSchema>;

// Define the collection with permissions and indexes
export const PostCollection = defineCollection({
  collectionName: 'Posts',
  schema: PostSchema,
  permissions: {
    listRule: '', // Anyone can list posts
    viewRule: '', // Anyone can view posts
    createRule: '@request.auth.id != "" && author = @request.auth.id',
    updateRule: '@request.auth.id != "" && author = @request.auth.id',
    deleteRule: '@request.auth.id != "" && author = @request.auth.id',
  },
  indexes: [
    // Optional: Add custom indexes for better query performance
    'CREATE INDEX `idx_posts_published` ON `posts` (`published`)',
  ],
});
```

### Available Field Helpers

The `pocketbase-zod-schema` package provides these field helpers:

- `TextField()` - String fields with validation
- `EmailField()` - Email validation
- `BoolField()` - Boolean fields
- `NumberField()` - Numeric fields
- `DateField()` - Date/datetime fields
- `FileField()` - File upload fields
- `RelationField({ collection })` - Relation to another collection
- `SelectField({ options })` - Select from predefined options
- `JsonField()` - JSON data fields

Each field helper returns a Zod schema that you can chain with additional validations like `.min()`, `.max()`, `.optional()`, `.default()`, etc.

### Collection Permissions

Define PocketBase API rules for each operation:

- `listRule` - Who can list records in the collection
- `viewRule` - Who can view individual records
- `createRule` - Who can create new records
- `updateRule` - Who can update existing records
- `deleteRule` - Who can delete records

Common permission patterns:

- `''` - Public access (anyone)
- `'@request.auth.id != ""'` - Any authenticated user
- `'id = @request.auth.id'` - Only the record owner (for user records)
- `'user = @request.auth.id'` - Only records where user field matches auth user

2. **Create a mutator** in `src/mutator/`:

```typescript
// src/mutator/postMutator.ts
import { RecordService } from 'pocketbase';
import { Post, PostInput, PostInputSchema } from '../schema/post';
import { TypedPocketBase } from '../types';
import { BaseMutator } from './baseMutator';

export class PostMutator extends BaseMutator<Post, PostInput> {
  constructor(pb: TypedPocketBase) {
    super(pb);
  }

  protected getCollection(): RecordService<Post> {
    return this.pb.collection<Post>('posts');
  }

  protected async validateInput(input: PostInput): Promise<PostInput> {
    return PostInputSchema.parse(input);
  }
}
```

3. **Export from index.ts**:

```typescript
export * from './schema/post.js';
export * from './mutator/postMutator.js';
```

4. **Use in your applications**:

```typescript
import { PostMutator, Post, PostInput } from '@project/shared';
```

## Database Migrations

The shared workspace can generate migrations for PocketBase schema changes using `pocketbase-zod-schema`:

```bash
# Generate a migration from schema changes
yarn workspace shared migrate:generate

# Check migration status
yarn workspace shared migrate:status
```

The migration generator:

1. Reads your collection definitions from `src/schema/`
2. Compares them with your current PocketBase schema
3. Generates migration files in `pb/pb_migrations/`
4. Automatically applies migrations when PocketBase starts

### Migration Workflow

1. **Define your collections** using `defineCollection()` in `src/schema/`
2. **Generate migration**: `yarn workspace shared migrate:generate`
3. **Review migration** in `pb/pb_migrations/` directory
4. **Apply migration**: Restart PocketBase or it will auto-apply on next start

Migrations are stored in `pb/pb_migrations/` and handle:

- Creating new collections
- Updating collection schemas
- Modifying permissions and rules
- Adding/removing indexes

## Development

The shared package is built as an ES module and provides both TypeScript types and compiled JavaScript for use across the monorepo.

**Remember:** Always use mutators for PocketBase data operations, never direct SDK calls.
