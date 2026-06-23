# Video Ware

A modern media upload and processing platform built with Next.js, PocketBase, and background workers. Upload media files, get resilient backups to S3-compatible storage, and receive fast previews (thumbnails, sprites) while background workers prepare assets using FFmpeg and Google Cloud APIs.

## Product Vision

Video Ware delivers a Next.js web app where users can:
- **Upload media** with progress tracking and validation
- **Get resilient backups** to S3-compatible storage
- **Receive fast previews** (thumbnails, sprites) while processing happens in the background
- **Process media** using FFmpeg and Google Cloud APIs (Transcoder, Video Intelligence)
- **Create and edit clips** with timeline composition
- **Get video analysis** with object detection, object tracking, face detection, person detection, speech transcription, and shot change detection
- **Render timelines** to final video outputs

## Architecture

- **Frontend**: Next.js 16 with React 19, TypeScript, and Tailwind CSS
- **Backend**: PocketBase for collections, real-time updates, authentication, and API
- **Workers**: NestJS background task processor with BullMQ for media processing (FFmpeg, Google Cloud APIs)
- **Storage**: S3-compatible bucket for originals, derivatives, and metadata
- **Shared Package**: TypeScript types, Zod schemas, and utilities used across the monorepo
- **Queue System**: Redis-backed BullMQ for reliable task processing with retries and progress tracking

## Monorepo Structure

This is a Yarn v4 workspace monorepo:

```
video-ware/
├── webapp/          # Next.js application (@project/webapp)
├── worker/          # Background worker for media processing
├── shared/          # Shared types, schemas, and utilities (@project/shared)
├── pb/              # PocketBase instance and migrations
└── docker/          # Docker configuration for deployment
```

## Quick Start

> **Just want to run it?** Use the prebuilt Docker image `ghcr.io/make-ware/video-ware:latest`, which bundles every service (PocketBase, webapp, worker, and nginx) in a single container. See the **[Docker Deployment Guide](docker/README.md)** for pull-and-run instructions. To develop locally, follow the steps below.

### Prerequisites

- Node.js >= 22.0.0
- Yarn 4.12.0
- FFmpeg (for media processing)
- Redis (required by the worker for the BullMQ task queue; defaults to `localhost:6379`)
- Google Cloud credentials (for video analysis features - optional)

### Local Development Setup

1. **Clone and install dependencies:**
   ```bash
   git clone https://github.com/make-ware/video-ware
   cd video-ware
   yarn install
   ```

2. **Configure environment (recommended):** copy the example file and set your
   own PocketBase admin credentials.
   ```bash
   cp .env.example .env
   ```
   ```
   POCKETBASE_ADMIN_EMAIL=admin@example.com
   POCKETBASE_ADMIN_PASSWORD=your-secure-password
   ```
   You can skip this — `yarn setup` creates `.env` from `.env.example` if it's
   missing — but you'll get the default credentials above instead of your own.

3. **Set up PocketBase:**
   ```bash
   yarn setup
   ```
   This creates `.env` from `.env.example` if it doesn't exist, downloads the
   PocketBase binary, and creates the admin account using the credentials from
   `.env`. The command is idempotent — if you change the credentials later, just
   edit `.env` and run `yarn setup` again.

4. **Build the shared package:**
   ```bash
   yarn build:shared
   ```

5. **Start Redis:** the worker connects to Redis on `localhost:6379` and has no
   in-memory fallback, so it must be running before you start the worker. Use
   whichever you have:
   ```bash
   redis-server                 # native install
   brew services start redis    # macOS (Homebrew, runs in background)
   docker run --rm -p 6379:6379 redis:7-alpine   # Docker
   ```
   To point at a different instance, set `REDIS_URL` in `.env`.

6. **Start development:**
   ```bash
   yarn dev
   ```

   This starts:
   - Next.js: http://localhost:3000
   - PocketBase: http://localhost:8090
   - Worker: Background task processor

## Documentation

- **[Development Guide](docs/DEVELOPMENT.md)** - Comprehensive development documentation
- **[GCVI Configuration Guide](docs/GCVI_CONFIGURATION.md)** - Google Cloud Video Intelligence processor configuration and cost optimization
- **[Deployment Guide](docker/README.md)** - Production Docker deployment instructions
- **[PocketBase Docs](docs/)** - PocketBase-specific documentation

## Worker Architecture

The worker is a NestJS application that processes background tasks using BullMQ:

### Task Types

1. **Process Upload** (`process_upload`)
   - Validates uploaded media files
   - Generates thumbnails, sprites, and proxy videos using FFmpeg
   - Creates Media records with metadata

2. **Transcode** (`transcode`)
   - Transcodes media to different formats/resolutions
   - Supports FFmpeg and Google Cloud Transcoder
   - Generates optimized proxy files for playback

3. **Detect Labels** (`detect_labels`)
   - Orchestrates multiple Google Cloud Video Intelligence processors
   - Uploads media to Google Cloud Storage
   - Runs five independent analysis processors in parallel:
     - Label Detection
     - Object Tracking
     - Face Detection
     - Person Detection
     - Speech Transcription
   - Normalizes and stores results in structured database entities

4. **Render Timeline** (`render_timeline`)
   - Renders timelines to final video outputs
   - Composes clips according to edit lists
   - Generates rendered video files

### Processing Features

- **Parent-Child Job Orchestration**: Complex workflows split into parallel step jobs
- **Partial Success Handling**: One processor can fail while others succeed
- **Response Caching**: API responses cached to avoid duplicate calls
- **Progress Tracking**: Real-time progress updates to PocketBase
- **Retry Logic**: Automatic retries with exponential backoff
- **Error Isolation**: Failures in one step don't block others

## Key Features

### Media Processing Pipeline

1. **Upload** - User uploads file, creates Upload + File records, stores to S3
2. **Process** - Background worker validates media, generates proxy, thumbnails, sprites
3. **Transcode** - Optional transcoding to different formats/resolutions using FFmpeg or Google Cloud Transcoder
4. **Detect Labels** - Google Cloud Video Intelligence API analyzes videos with five independent processors:
   - **Label Detection**: Detects objects, activities, locations, and shot changes
   - **Object Tracking**: Tracks objects across frames with bounding boxes and keyframes
   - **Face Detection**: Detects and tracks faces with attributes (headwear, glasses, looking at camera)
   - **Person Detection**: Detects and tracks persons with pose landmarks
   - **Speech Transcription**: Transcribes speech to text with timestamps
5. **Normalize & Store** - Detection results are normalized into structured database entities:
   - `LabelEntity`: Canonical entities (e.g., "Face", "Person", "Car")
   - `LabelTrack`: Tracked detections with keyframes and metadata
   - `LabelClip`: Significant appearances meeting quality thresholds
   - `LabelMedia`: Aggregated statistics and processing metadata
6. **Timeline Editing** - Create and edit timelines with clip composition
7. **Render** - Export timelines to final video outputs

### Workspace-Scoped Tenancy

All operations occur under a `workspaceRef`:
- Users participate in workspaces via membership records with roles (owner, admin, member, viewer)
- Permissions and queries are scoped by workspace
- Supports multi-user collaboration with role-based access control

### Background Task Processing

- Resilient task queue using BullMQ (Redis-backed)
- Progress tracking and error handling
- Retry logic with exponential backoff
- Parent-child job orchestration for complex workflows
- Partial success handling (one processor can fail while others succeed)
- Observability for job states and errors
- Task status updates in PocketBase for real-time UI updates

### Video Analysis

The platform integrates with Google Cloud Video Intelligence API to provide comprehensive video analysis:

- **Modular Architecture**: Each analysis type (label detection, object tracking, face detection, person detection, speech transcription) runs as an independent processor
- **Cost Control**: Enable or disable processors individually via environment variables
- **Response Caching**: API responses are cached to avoid duplicate API calls
- **Normalized Storage**: Raw API responses plus normalized database entities for fast querying
- **Versioning**: Processing results are versioned to track model updates and reprocessing
- **Keyframe Extraction**: Tracks include keyframes with bounding boxes and timestamps
- **Attribute Detection**: Face detection includes attributes like headwear, glasses, and camera gaze

### Timeline Editing & Composition

- **Clip Management**: Create clips from media with time range selection
- **Timeline Editor**: Drag-and-drop interface for composing clips into timelines
- **Edit List Generation**: Automatic generation of edit lists for rendering
- **Version Control**: Timeline versions track changes and enable rollback
- **Render Tasks**: Queue video rendering jobs with configurable output settings

## Common Commands

```bash
# Development
yarn dev                              # Start all services (Next.js + PocketBase + Worker)
yarn workspace @project/webapp dev    # Next.js only
yarn workspace @project/pb dev        # PocketBase only
yarn workspace @project/worker dev    # Worker only

# Building
yarn build                           # Build all packages
yarn workspace @project/shared build # Build shared package

# Code Quality
yarn lint                            # Lint all workspaces (auto-fix)
yarn lint:check                      # Lint all workspaces (check only)
yarn typecheck                       # Type check all workspaces
yarn format                          # Format all code

# Testing
yarn test                            # Run all tests
yarn test:watch                     # Watch mode

# Type Generation
yarn typegen                        # Generate types from PocketBase

# Database
yarn db:migrate                     # Generate migration from schema changes
yarn db:status                      # Check migration status
yarn db:download                    # Download PocketBase binary
yarn db:start                       # Start PocketBase in debug mode

# Docker / Staging
yarn staging:build                  # Build Docker image
yarn staging:run                    # Run Docker container
yarn staging:up                     # Build and run
yarn staging:stop                   # Stop container
yarn staging:logs                   # View container logs
yarn staging:clean                  # Clean staging data and images

# Maintenance
yarn clean                          # Clean all build artifacts
yarn setup                          # Reinstall PocketBase
yarn precommit                      # Run lint, typecheck, format, and test
```

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui
- **Backend**: PocketBase (Go-based backend-as-a-service)
- **Worker**: NestJS with BullMQ for task processing
- **Queue**: Redis-backed BullMQ for reliable job processing
- **Validation**: Zod schemas with `pocketbase-zod-schema`
- **Storage**: S3-compatible (configurable), Google Cloud Storage
- **Media Processing**: FFmpeg (thumbnails, sprites, proxies, transcoding)
- **Video Analysis Services**: Google Cloud Video Intelligence API, Google Cloud Transcoder, Google Cloud Speech-to-Text
- **Package Manager**: Yarn 4.12.0 with workspaces
- **Testing**: Vitest
- **Deployment**: Docker with multi-stage builds, nginx, supervisor

## Contributing

1. Read the [Development Guide](docs/DEVELOPMENT.md)
2. Set up your development environment
3. Create a feature branch
4. Make your changes
5. Run tests and linting: `yarn precommit`
6. Submit a pull request

## License

See [LICENSE](pb/LICENSE.md) for details.

## Links

- [PocketBase Documentation](https://pocketbase.io/docs/)
- [Next.js Documentation](https://nextjs.org/docs)
- [Yarn Workspaces](https://yarnpkg.com/features/workspaces)
