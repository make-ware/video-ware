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
- **Storage** (`shared/src/storage/`): Interface-based `StorageBackend` with `LocalStorageBackend` and `S3StorageBackend` implementations, created via factory function. Server-only entrypoint (see below).
- **Browser/server split in shared**: `@project/shared` is consumed by the browser (Next.js client), the Next.js server, and the NestJS worker. Every entrypoint except `./storage` must stay browser-safe (no Node built-ins in its import graph) — enforced by `shared/src/__tests__/browser-safety.test.ts`. Server-only entrypoints map the `browser` condition in package.json `exports` to a throwing stub (`storage/browser-stub.ts`) so accidental client imports fail loudly at build/dev time. When adding a Node-only module to shared: give it its own entrypoint, add a browser-stub `exports` mapping, and list it under `SERVER_ONLY` in the browser-safety test. Pure helpers needed by the browser must live in isomorphic entrypoints, never in server-only ones.
- **Worker processors** (`worker/src/task-*/`): Each task type has processors (BullMQ handlers), executors (step implementations), normalizers (API response → DB schema), and services.
- **Timeline editor realtime** (`webapp/src/contexts/timeline-context.tsx` + `webapp/src/utils/timeline-realtime.ts`): the editor's timeline lives in the TanStack Query cache (`qk.timelines.detail`); PocketBase SSE subscriptions (TimelineClips + TimelineTracks filtered by `TimelineRef`, plus the Timelines record) fold events into that cache via pure merge helpers. Invariants: merges return the SAME reference on no-ops (echoes of local writes, stale events) so structural sharing suppresses re-renders; a record replaces the cached one only when its `updated` stamp is strictly newer; the subscription effect's deps stay stable identities (`[timelineId, queryClient]`) so data changes can never resubscribe; event handlers never write to the DB (no side effects — the SSE layer stays read-only). **Gap healing**: subscribe first, then invalidate the timeline query once after all subscriptions are live, so events landing between the initial fetch's server read and subscription setup are never lost — any new subscription must keep this subscribe-then-refetch order. Nested timelines' own clips are deliberately not subscribed; a refresh picks up their changes. The unsaved-changes baseline (`originalTimeline`) is never touched by realtime merges — remote edits light up Save just like local ones.
- **CLI list pattern** (`cli/src/lib/list/`): every `vw … list`/`… search` command is a declarative `ListSpec` (filters, sorts, columns, page size) plus a `fetchPage` closure; `withListOptions(cmd, spec)` registers `-w`/`--json`/`-n,--limit`/`--page`/`--sort`/`--all` and the declared filters, and `runList`/`runMergedList` own paging, printing, and the footer. Specs live in the `lib/*.ts` beside their columns and parsers, not in the command files. Invariants: page size defaults to 100 and `--limit` is clamped at 500; filter values are bound one clause at a time through `pb.filter` (never interpolated, and per-clause binding means two filters can both use `{:q}`); `resolveListQuery`/`listFooter`/`fetchMergedPage` stay pure so output is unit-testable (`__tests__/list-*.test.ts`, plus the `captureList` harness); a list that spans several collections (the label fan-outs) pages by over-fetching `page × perPage` per source and slicing the merge, which is only correct while each source's server sort matches the merge comparator — `labelPbSort` and `labelHitCompare` must change together. Structure lists (`timeline clips list`, `timeline track list`) set `unpaged: true` because their rows are computed from a whole timeline. Prefer adding a filter over adding a command: the footer advertises unused filters, and `required`/`requireOneOf` make a list demand one instead of scanning a workspace.
- **Label list pattern** (`webapp/src/hooks/use-label-list.ts`): every media-viewer label page (objects, faces, people, shots, segments, text, speakers, transcripts) pages through one hook driven by a declarative `LabelListSource`. Structural facts come from the shared `LABEL_TYPE_META` (collection, confidence column) and read facts from `LABEL_LIST_SOURCES` — an exhaustive `Record<LabelType, LabelListSource>`, so a new label type fails to compile until it is listed. `InspectorTypeConfig` (`components/labels/inspector/config.ts`) is presentation-only. Invariants: it wraps the non-realtime `useInfiniteList` on purpose (worker label jobs write thousands of rows per ingest; user writes invalidate the `['labels']` prefix instead of streaming); every filter — confidence, duration, text query, and the generic `equals` map (e.g. `speakerId`) — is server-side and bound one clause at a time through `pb.filter`, with field names coming from the source and only values ever bound; `buildLabelFilter` stays pure so the clause set is unit-testable. **Paged vs aggregate**: anything derived from rows (entity summary chips, selection, Select All) describes the LOADED window and the `LibraryLoadMore` footer says how much of the total that is — a figure that must be honest over the whole media gets its own read instead (`useMediaSpeakerSummaries` with `SPEAKER_SUMMARY_FIELDS`, and the lazy `speakerTextQueryOptions` / `transcriptTextQueryOptions` behind Raw Text and Copy).
- **Ingest spec + backfill** (`shared/src/jobs/transcode/ingest-spec.ts` + `worker/src/tasks/ingest-backfill.service.ts`): one canonical description of what a full ingest produces. Every producer of derived assets builds its `process_upload` payload from `buildIngestTranscodeConfig` / `pickIngestTranscodeConfig` — the worker's ingest orchestrator, the webapp's regenerate, `vw job transcode`, and the weekly backfill — so all four request identical geometry (they used to hold drifted copies of these literals). Each asset step carries a version in `INGEST_STEP_VERSIONS`; its processor stamps that onto the File it writes (`File.meta.ingestVersion` via `ingestMeta(step)`), and the weekly `ingest_backfill` task (PB cron `cron-ingest-backfill.pb.js` → `IngestBackfillService`) queues a `process_upload` for exactly the steps a media is **missing** (ingested before that step existed) or holds at an **outdated** version. Invariants: changing what a step emits means editing the spec AND bumping its version — that is the whole seamless-rollout mechanism; unstamped legacy files read as `INGEST_BASELINE_VERSION` (1), never 0, so shipping the spec doesn't re-encode the library; `planIngestBackfill` stays pure (the caller supplies observed state) so the decision is unit-testable; expected steps are derived from the config itself, never a second hand-kept list; and the sweep is bounded — per-run task/scan caps, a skip for transcodes already in flight, and abandonment after repeated failures, so an unprocessable media isn't re-queued forever.
- **Environment validation** (`shared/src/env.ts`): All env vars validated with Zod via `validateEnv()` / `parseEnvOrThrow()`.

## Code Style

- TypeScript strict mode across all workspaces
- ESLint flat config with `@typescript-eslint` strict rules
- Unused vars must be prefixed with `_` (error-level rule)
- No `console.log` in shared workspace
- Prettier: single quotes, semicolons, trailing commas (es5), 80 char width, 2-space indent
- Vitest for all testing (not Jest) — webapp uses `happy-dom` environment, worker and shared use `node`

## Logging

The worker uses the built-in **NestJS logger** (`new Logger(ClassName.name)`), not
`console.*`. Verbosity is controlled by `LOG_LEVEL`
(`verbose | debug | info | warn | error`), mapped onto NestJS levels in
[`worker/src/config/log-level.ts`](worker/src/config/log-level.ts) and applied once at
`NestFactory.create`. **`LOG_LEVEL` defaults to `debug`** — a plain local run shows the
full operational trace; set `LOG_LEVEL=info` (or higher) in production for a
signal-only stream.

Choosing a level when writing a log line — the guiding question is _"would an operator
want to see this at `info` in production?"_:

- **`error`** — an operation failed unrecoverably (task/step exhausted retries, an
  unhandled throw). Include the stack for `Error`s.
- **`warn`** — degraded-but-handled: a retryable step failure, a best-effort cleanup
  that failed, a tolerated missing/skipped condition.
- **`log`** (NestJS "info") — durable, coarse-grained signals worth keeping in
  production. Roughly **one line per task or per lifecycle event**, never per step or per
  file: service/config startup, "Task X started", "Task X completed successfully: N
  steps…", one-time migration/cleanup summaries.
- **`debug`** — routine per-step / per-job / per-file operational detail: individual
  step start/complete, per-child job-completed events, individual file
  upload/download/delete, per-directory cleanup/purge. This is the "ignore me unless I'm
  debugging" tier.
- **`verbose`** — extremely chatty tracing (e.g. "created temp directory").

Rule of thumb: if a message fires once per media file, per step, or per storage
operation, it's `debug`. Reserve `log` for whole-task and process-lifecycle milestones so
raising `LOG_LEVEL` to `info` leaves a clean, low-volume signal stream.

## Node/Engine Requirements

- Node.js >= 22.0.0
- Yarn 4.12.0 (managed via Corepack)
