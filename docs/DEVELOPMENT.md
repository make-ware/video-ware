# Development Guide

## Monorepo Structure

This project is a Yarn v4 workspace monorepo with the following structure:

```
video-ware/
├── webapp/          # Next.js application (@project/webapp)
├── worker/          # Background worker for media processing (@project/worker)
├── shared/          # Shared types, schemas, and utilities (@project/shared)
├── pb/              # PocketBase instance and migrations (@project/pb)
└── docker/          # Docker configuration for deployment
```

### Workspaces

- **`@project/webapp`**: Next.js 16 application with React 19, TypeScript, and Tailwind CSS
- **`@project/worker`**: NestJS background worker for media processing (FFmpeg, Google Cloud APIs)
- **`@project/shared`**: Shared package containing:
  - Zod validation schemas for PocketBase collections
  - TypeScript type definitions
  - PocketBase client utilities
  - Migration configuration
  - Type generation tools
  - Storage backends (S3, local)
  - Job definitions and types
- **`@project/pb`**: PocketBase instance with hooks and migrations

## Prerequisites

The following software is required for development:

- Node.js >= 22.0.0
- Yarn 4.12.0
- FFmpeg (for media processing)
- Redis (required for BullMQ task queue)
- Google Cloud Project with Video Intelligence API enabled (optional for analysis features)

## Getting Started

1. **Initial Setup:**
   ```bash
   yarn install
   yarn setup
   ```
   This command installs dependencies, downloads the PocketBase binary, and initializes the database.

2. **Create Admin Account:**
   
   **Option A - Environment Variable Configuration (Recommended):**
   ```bash
   export POCKETBASE_ADMIN_EMAIL=admin@example.com
   export POCKETBASE_ADMIN_PASSWORD=your-secure-password
   yarn setup
   ```
   Providing these environment variables during setup will automatically create a superuser.
   
   **Option B - CLI Interaction:**
   ```bash
   yarn workspace @project/pb admin
   ```
   Follow the interactive prompts to create an administrative account.

3. **Build Shared Package:**
   ```bash
   yarn workspace @project/shared build
   ```
   The shared package provides common types and schemas and must be built before starting application services.

4. **Start Development Environment:**
   ```bash
   yarn dev
   ```
   This command initializes all required services:
   - Shared Workspace: Starts in watch mode for incremental builds.
   - Web Application: Accessible at http://localhost:3000.
   - PocketBase: Accessible at http://localhost:8090.
   - Worker: Background task processing engine.

## Google Cloud Video Intelligence Configuration

Video Ware integrates with Google Cloud Video Intelligence API for video analysis. The system supports five independent processors that can be enabled/disabled for cost optimization:

- **Label Detection** - Content categorization and scene detection (~$0.01/min)
- **Object Tracking** - Object movement analysis (~$0.025/min)
- **Face Detection** - Face presence detection (~$0.025/min)
- **Person Detection** - Person tracking with pose landmarks (~$0.025/min)
- **Speech Transcription** - Speech-to-text with timestamps (~$0.024/min)

**Quick Start:**
```bash
# Enable only what you need in .env
ENABLE_LABEL_DETECTION=true
ENABLE_OBJECT_TRACKING=false
ENABLE_FACE_DETECTION=false
ENABLE_PERSON_DETECTION=false
ENABLE_SPEECH_TRANSCRIPTION=true

# Configure Google Cloud credentials
GOOGLE_PROJECT_ID=your-gcp-project-id
GOOGLE_CLOUD_CREDENTIALS={"type":"service_account",...}
GCS_BUCKET=your-gcs-bucket-name
```

For detailed configuration, cost optimization strategies, and troubleshooting, see the **[GCVI Configuration Guide](GCVI_CONFIGURATION.md)**.

## Development Workflow

### Backend Development (PocketBase)

1. **Access Admin UI:** http://localhost:8090/_/
2. **Create Collections:** Use the admin interface to define your data schema
3. **Add Custom Logic:** Edit `pb/pb_hooks/main.pb.js` for custom business logic
4. **API Testing:** Use the built-in API explorer in the admin UI

### Shared Package Development

The `@project/shared` workspace contains all shared types, schemas, and utilities used across the monorepo.

#### Package Structure

```
shared/
├── src/
│   ├── schema/          # Zod schemas for collections
│   ├── mutators/        # Data transformation utilities
│   ├── types/           # TypeScript type definitions
│   ├── jobs/            # Job definitions and types
│   ├── storage/         # Storage backends (S3, local)
│   ├── config/          # Configuration utilities
│   ├── pocketbase/      # PocketBase client configuration
│   ├── utils/           # Utility functions
│   ├── schema.ts        # Main schema exports
│   ├── enums.ts         # Shared enums
│   ├── types.ts         # Type exports
│   └── mutator.ts       # Mutator exports
├── dist/                # Compiled JavaScript (generated)
└── package.json
```

#### Using Shared Schemas in Webapp/Worker

Import schemas and types from `@project/shared`:

```typescript
// Import schemas
import { MediaSchema, UploadSchema } from '@project/shared/schema';
import { TaskStatus, FileType } from '@project/shared/enums';
import type { Media, Upload } from '@project/shared/schema';

// Use in validation
const validatedMedia = MediaSchema.parse(mediaData);

// Use in forms
const uploadData = UploadSchema.parse(formData);
```

#### Adding New Schemas

1. **Create schema file** in `shared/src/schema/`:
   ```typescript
   // shared/src/schema/media.ts
   import { baseSchema, baseSchemaWithTimestamps, defineCollection } from "pocketbase-zod-schema/schema";
   import { z } from "zod";

   export const MediaSchema = z
     .object({
       workspaceRef: z.string(),
       uploadRef: z.string(),
       duration: z.number(),
       mediaType: z.enum(['video', 'audio', 'image']),
     })
     .extend(baseSchema)
     .extend(baseSchemaWithTimestamps);

   const mediaCollection = defineCollection({
     schema: MediaSchema,
     collectionName: "Media",
     type: "base",
     permissions: {
       listRule: "workspaceRef.id ?= @request.auth.id",
       viewRule: "workspaceRef.id ?= @request.auth.id",
       createRule: "@request.auth.id != ''",
       updateRule: "workspaceRef.id ?= @request.auth.id",
       deleteRule: "workspaceRef.id ?= @request.auth.id",
     },
   });

   export default mediaCollection;
   export type Media = z.infer<typeof MediaSchema>;
   ```

2. **Export from** `shared/src/schema/index.ts`:
   ```typescript
   export * from './media.js';
   ```

3. **Rebuild the shared package:**
   ```bash
   yarn workspace @project/shared build
   ```

4. **Use in webapp/worker:**
   ```typescript
   import { MediaSchema, Media } from '@project/shared/schema';
   ```

#### Schema Development Workflow

1. Edit schema files in `shared/src/schema/`
2. Run `yarn workspace @project/shared dev` for watch mode, or
3. Run `yarn workspace @project/shared build` to compile
4. The webapp and worker will automatically pick up changes after rebuild

### Frontend Development (Next.js)

The `@project/webapp` workspace is a Next.js 16 application.

#### Using PocketBase Client

The shared package provides PocketBase client utilities:

```typescript
// Import PocketBase client from shared package
import { createPocketBaseClient } from '@project/shared/pocketbase';

// Or use directly
import PocketBase from 'pocketbase';

export const pb = new PocketBase(process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://localhost:8090');
```

#### Example Usage

```typescript
// Fetch data with validation
import { MediaSchema } from '@project/shared/schema';

const records = await pb.collection('media').getFullList();
const validatedMedia = records.map(record => MediaSchema.parse(record));

// Authentication
await pb.collection('users').authWithPassword(email, password);

// Real-time subscriptions
pb.collection('media').subscribe('*', (e) => {
  console.log(e.action, e.record);
});
```

#### Form Validation with React Hook Form

```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { UploadSchema, type Upload } from '@project/shared/schema';

function UploadForm() {
  const { register, handleSubmit, formState: { errors } } = useForm<Upload>({
    resolver: zodResolver(UploadSchema),
  });

  const onSubmit = async (data: Upload) => {
    // Handle upload
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {/* form fields */}
    </form>
  );
}
```

### Worker Development

The `@project/worker` workspace is a NestJS application that processes background tasks.

#### Worker Structure

```
worker/
├── src/
│   ├── processors/      # Task processors (FFmpeg, Google Cloud APIs)
│   ├── queues/          # BullMQ queue configurations
│   ├── services/        # Business logic services
│   ├── config/          # Configuration modules
│   └── main.ts          # Application entry point
└── package.json
```

#### Running the Worker

```bash
# Start worker in development mode
yarn workspace @project/worker dev

# Or start all services
yarn dev
```

#### Adding New Processors

1. Create a processor class in `worker/src/processors/`
2. Register it with the appropriate queue
3. Define job types in `shared/src/jobs/`
4. Update task contracts in `shared/src/types/task-contracts.ts`

## Type Generation

Generate TypeScript types from your PocketBase collections:

1. **Start PocketBase:**
   ```bash
   yarn workspace @project/pb dev
   # or
   yarn db:start
   ```

2. **Generate types:**
   ```bash
   yarn typegen
   # or
   yarn workspace @project/shared typegen
   ```

3. **Types will be generated in** `shared/src/types/pocketbase.ts`

## Migrations

The shared package includes PocketBase migration configuration in `shared/pocketbase-migrate.config.js`.

### Migration Workflow

1. Define schemas in `shared/src/schema/` using `defineCollection()`
2. Use PocketBase admin UI to create/update collections
3. Generate migration snapshots:
   ```bash
   yarn db:migrate
   ```
4. Check migration status:
   ```bash
   yarn db:status
   ```

## Common Tasks

### Adding a New Collection

1. **Define the schema** in `shared/src/schema/` (see "Adding New Schemas" above)
2. **Create the collection** in PocketBase Admin UI (http://localhost:8090/_/)
3. **Set up validation rules** and API permissions in the admin UI
4. **Rebuild shared package:**
   ```bash
   yarn workspace @project/shared build
   ```
5. **Generate types** (optional):
   ```bash
   yarn typegen
   ```

### Custom API Endpoints

Add to `pb/pb_hooks/main.pb.js`:

```javascript
routerAdd("GET", "/api/custom", (c) => {
  return c.json(200, { message: "Custom endpoint" });
});
```

### Environment Variables

Create `.env.local` in the webapp directory:

```bash
# webapp/.env.local
NEXT_PUBLIC_POCKETBASE_URL=http://localhost:8090
```

For worker configuration, create `.env` in the worker directory:

```bash
# worker/.env
POCKETBASE_URL=http://localhost:8090
REDIS_HOST=localhost
REDIS_PORT=6379

# Storage Configuration
S3_ENDPOINT=your-s3-endpoint
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
S3_BUCKET=your-bucket-name
S3_REGION=us-east-1

# Google Cloud Configuration (optional)
GOOGLE_PROJECT_ID=your-gcp-project-id
GOOGLE_CLOUD_CREDENTIALS={"type":"service_account",...}
GCS_BUCKET=your-gcs-bucket-name

# GCVI Processor Configuration (optional)
ENABLE_LABEL_DETECTION=true
ENABLE_OBJECT_TRACKING=false
ENABLE_FACE_DETECTION=false
ENABLE_PERSON_DETECTION=false
ENABLE_SPEECH_TRANSCRIPTION=true
```

See `.env.example` in the root directory for a complete list of available configuration options.

For detailed GCVI processor configuration and cost optimization, see the **[GCVI Configuration Guide](GCVI_CONFIGURATION.md)**.

## Troubleshooting

### PocketBase Issues

- Check if port 8090 is available
- Verify binary permissions: `chmod +x pb/pocketbase`
- Check logs in `pb/pb_data/logs/`
- Restart PocketBase: `yarn workspace @project/pb dev`

### Next.js Issues

- Clear cache: `yarn workspace @project/webapp clean`
- Check TypeScript errors: `yarn workspace @project/webapp typecheck`
- Rebuild shared package if imports fail: `yarn workspace @project/shared build`

### Worker Issues

- Check Redis connection: Ensure Redis is running on the configured host/port
- Check environment variables: Verify all required worker environment variables are set
- Check logs: Worker logs will show in the console when running `yarn dev`

### Shared Package Issues

- **Import errors**: Make sure the shared package is built (`yarn workspace @project/shared build`)
- **Type errors**: Rebuild the shared package after schema changes
- **Module not found**: Check that `@project/shared` is listed in `webapp/package.json` and `worker/package.json` dependencies

### Yarn Workspace Issues

- Reinstall dependencies: `yarn install`
- Check workspace configuration in root `package.json`
- Verify `.yarnrc.yml` exists and is configured correctly
- Ensure all workspaces use the same Yarn version (4.12.0)

## Production Deployment

### PocketBase

1. Build for production
2. Set environment variables
3. Configure reverse proxy (nginx/caddy)
4. Set up SSL certificates

### Next.js

1. **Build shared package:**
   ```bash
   yarn workspace @project/shared build
   ```

2. **Build webapp:**
   ```bash
   yarn workspace @project/webapp build
   ```
   Or build everything:
   ```bash
   yarn build
   ```

3. Deploy to Vercel/Netlify or use Docker
4. Update `NEXT_PUBLIC_POCKETBASE_URL` to production URL

### Worker

1. **Build shared package:**
   ```bash
   yarn workspace @project/shared build
   ```

2. **Build worker:**
   ```bash
   yarn workspace @project/worker build
   ```

3. Deploy worker with proper environment variables
4. Ensure Redis is accessible
5. Configure storage backends (S3, GCS)

### Docker Deployment

See the **[Deployment Guide](DEPLOYMENT.md)** for Docker-based deployment instructions.

## Useful Commands

```bash
# Development
yarn dev                              # Start all services (shared, webapp, PocketBase, worker)
yarn workspace @project/webapp dev    # Next.js only
yarn workspace @project/pb dev         # PocketBase only
yarn workspace @project/worker dev    # Worker only
yarn workspace @project/shared dev    # Watch mode for shared package

# Building
yarn build                           # Build all packages
yarn workspace @project/shared build # Build shared package only
yarn workspace @project/webapp build # Build webapp only
yarn workspace @project/worker build # Build worker only

# Code Quality
yarn lint                            # Lint all workspaces
yarn lint:check                      # Check linting without fixing
yarn typecheck                       # Type check all workspaces
yarn format                          # Format all code
yarn format:check                    # Check formatting

# Testing
yarn test                            # Run all tests
yarn test:watch                      # Watch mode tests

# Type Generation
yarn typegen                         # Generate TypeScript types from PocketBase

# Database
yarn db:migrate                      # Generate migration from schema changes
yarn db:status                       # Check migration status
yarn db:download                     # Download PocketBase binary
yarn db:start                        # Start PocketBase in debug mode
yarn db:typegen                      # Generate types from migrations

# Docker / Staging
yarn staging:build                   # Build Docker image
yarn staging:run                     # Run Docker container
yarn staging:up                      # Build and run
yarn staging:stop                    # Stop container
yarn staging:logs                    # View container logs
yarn staging:clean                   # Clean staging data and images

# Maintenance
yarn clean                           # Clean all build artifacts
yarn setup                           # Reinstall PocketBase
yarn precommit                       # Run lint, typecheck, format, and test
```

## Workspace Package Names

When running workspace commands, use the package names:

- `@project/webapp` - Next.js application
- `@project/worker` - NestJS background worker
- `@project/shared` - Shared types and schemas
- `@project/pb` - PocketBase instance

Example:
```bash
yarn workspace @project/webapp add some-package
yarn workspace @project/shared add some-package
yarn workspace @project/worker add some-package
```
