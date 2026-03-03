# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
yarn install

# Run all workspaces in dev mode (shared, webapp, pocketbase, worker)
yarn dev

# Build all workspaces
yarn build

# Build only shared (required before other workspaces can build/run)
yarn build:shared

# Lint (auto-fix) / check only
yarn lint
yarn lint:check

# Format (auto-fix) / check only
yarn format
yarn format:check

# Type check all workspaces
yarn typecheck

# Run all tests
yarn test

# Run tests in watch mode (shared + webapp)
yarn test:watch

# Run a single workspace's tests
yarn workspace @project/shared test
yarn workspace @project/webapp test
yarn workspace @project/worker test

# Run a single test file
yarn workspace @project/shared vitest run path/to/file.test.ts
yarn workspace @project/webapp vitest run path/to/file.test.ts

# Generate types from PocketBase schema
yarn typegen

# Full pre-commit validation pipeline
yarn precommit
```

## Architecture

This is a **Yarn v4 monorepo** (`yarn@4.12.0`) with four workspaces:

### Workspaces

- **`shared/`** (`@project/shared`) — Zod schemas, TypeScript types, PocketBase mutators, job definitions, storage backends. Built with `tsup` as dual CJS/ESM. **Must be built first** before other workspaces.
- **`webapp/`** (`@project/webapp`) — Next.js 16 frontend with React 19, Tailwind CSS, and shadcn/ui. Uses App Router. Path alias: `@/*` → `src/*`.
- **`worker/`** (`@project/worker`) — NestJS background worker for media processing. Uses BullMQ (Redis-backed) with 4 queues: TRANSCODE, INTELLIGENCE, RENDER, LABELS. Integrates Google Cloud Video Intelligence API. Uses CommonJS modules with decorators enabled.
- **`pb/`** (`@project/pb`) — PocketBase database instance, migrations, and server-side hooks.

### Data Flow

```
shared (schemas, types, mutators)
  ↓
webapp: lib/pocketbase.ts → mutators/ → services/ → contexts/ → hooks/ → components/ → app/
worker: queue/ → task-*/processors → task-*/executors → task-*/normalizers → PocketBase updates
```

### Key Patterns

- **Mutators** (`shared/src/mutators/`): `BaseMutator<T, TInput>` base class wrapping PocketBase CRUD with Zod validation. Each collection has a dedicated mutator. Used by both webapp and worker.
- **Job definitions** (`shared/src/jobs/`): Typed contracts for transcode, render, labels, and recommendations jobs with step-level input/output types.
- **Storage** (`shared/src/storage/`): Interface-based `StorageBackend` with `LocalStorageBackend` and `S3StorageBackend` implementations, created via factory function.
- **Worker processors** (`worker/src/task-*/`): Each task type has processors (BullMQ handlers), executors (step implementations), normalizers (API response → DB schema), and services.
- **Environment validation** (`shared/src/env.ts`): All env vars validated with Zod via `validateEnv()` / `parseEnvOrThrow()`.

## Code Style

- TypeScript strict mode across all workspaces
- ESLint flat config with `@typescript-eslint` strict rules
- Unused vars must be prefixed with `_` (error-level rule)
- No `console.log` in shared workspace
- Prettier: single quotes, semicolons, trailing commas (es5), 80 char width, 2-space indent
- Vitest for all testing (not Jest) — webapp uses `happy-dom` environment, worker and shared use `node`

## Node/Engine Requirements

- Node.js >= 22.0.0
- Yarn 4.12.0 (managed via Corepack)
