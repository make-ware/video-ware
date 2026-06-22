# PocketBase Hooks

Server-side JavaScript hooks (in [`pb_hooks/`](pb_hooks)) that PocketBase runs on
DB events and on a schedule. They turn plain record writes into background work and
keep referential cleanup correct **for every caller** — webapp, CLI, the PocketBase
dashboard, or raw REST.

## How they load

PocketBase auto-loads **every `*.pb.js` file in `pb_hooks/`** at boot (and
hot-reloads on change in dev, via `--hooksWatch`).

> ⚠️ The `.pb.js` suffix is required. A file named `*.js` is **silently ignored** —
> the hook simply never runs.

The hooks run in PocketBase's embedded JS engine (goja), **not** Node: no `fetch`,
no `fs`, no `setTimeout`, ES5-ish. See [PB_EXTENDING.md](../docs/PB_EXTENDING.md).

## Naming convention

| Pattern | For | Example |
| --- | --- | --- |
| `hook-<collection>-<create\|delete>.pb.js` | a record lifecycle hook | `hook-media-delete.pb.js` |
| `cron-<name>.pb.js` | a scheduled job | `cron-storage-cleanup.pb.js` |
| `main.pb.js` | PocketBase entry / scaffolding | — |

A single file owns all of one collection's hooks for that action (e.g.
`hook-media-delete.pb.js` holds both the before- and after-delete handlers).

## The core pattern

The database is the source of truth and **hooks stay dumb**: a hook may read a few
fields and create a `Tasks` row, but no heavy logic, no HTTP, no external calls —
the NestJS worker (`worker/src/...`) polls `Tasks` and does the real work. Full
explanation and the client contract live in [PB_TRIGGERS.md](../docs/PB_TRIGGERS.md).

```
client write (PB REST) ──► hook (dumb) ──► Tasks row ──► worker polls + acts
```

Two conventions every handler follows:

- **Best-effort, never block the write.** Wrap the body in `try/catch`, log on
  failure, and always call `e.next()` in a `finally`. A leaked blob or orphaned
  task is recoverable (the `cleanup` task); a wedged create/delete is not.
- **Idempotent.** Triggers skip if an active (`queued`/`running`) task already
  exists, so retries and double-fires don't duplicate work.

## The hooks

### Triggers — turn a write into worker work

| File | Event(s) | What it does |
| --- | --- | --- |
| [`hook-uploads-create.pb.js`](pb_hooks/hook-uploads-create.pb.js) | Uploads create + update | When `status === 'uploaded'`, create one `full_ingest` Task. The worker creates the Media and fans out transcode/labels. |
| [`hook-timeline-renders-create.pb.js`](pb_hooks/hook-timeline-renders-create.pb.js) | TimelineRenders create | Create one `render_timeline` Task; the worker renders and writes the output file + status back onto the same record. |
| [`hook-users-create.pb.js`](pb_hooks/hook-users-create.pb.js) | Users create | Bootstrap a `Workspaces` record + `WorkspaceMembers` membership for the new user. |

### Delete cleanup — what foreign-key cascade can't express

Most derived data is reaped by the schema itself (child collections cascade via
their `MediaRef` relations). These hooks handle the gaps.

| File | Event(s) | What it does |
| --- | --- | --- |
| [`hook-media-delete.pb.js`](pb_hooks/hook-media-delete.pb.js) | Media delete (before) + after-delete | **Before:** flag referencing `TimelineClips` as `meta.mediaMissing` so the editor preserves them. **After:** delete `Tasks` keyed by `sourceId` (no FK to cascade) and the orphaned `Upload` (reverse FK; guarded against shared uploads). |
| [`hook-uploads-delete.pb.js`](pb_hooks/hook-uploads-delete.pb.js) | Uploads after-delete | Tombstone the original blob (`externalPath`) into `Artifacts` for the `cleanup` task to reap from storage. |
| [`hook-files-delete.pb.js`](pb_hooks/hook-files-delete.pb.js) | Files after-delete | Tombstone the external blob (`storageKey`) into `Artifacts`. PB-native files (no `storageKey`) are skipped — PocketBase deletes those itself. |

### Scheduled

| File | Schedule | What it does |
| --- | --- | --- |
| [`cron-storage-cleanup.pb.js`](pb_hooks/cron-storage-cleanup.pb.js) | `0 0 * * 0` (Sun 00:00) | Create one `cleanup` Task. The worker drains `Artifacts` (deletes orphaned blobs), prunes stale Files, backfills `Files.MediaRef`, and clears stale workdirs. Run on demand: dashboard → Crons → `storageCleanup`. |

### Misc

| File | Event(s) | What it does |
| --- | --- | --- |
| [`main.pb.js`](pb_hooks/main.pb.js) | Users create-request | Scaffolding from `pocketbase init` (logs new-user emails, has commented examples). Safe to extend or remove. |

## Adding a hook

1. Decide the source write that should start work (a status change, a new record, a delete).
2. Create `pb_hooks/hook-<collection>-<create|delete>.pb.js` (or `cron-<name>.pb.js`
   for a scheduled job). For a trigger, create a single `Tasks` row of the right
   `type`; keep it self-contained and never throw past `e.next()`.
3. Implement/extend the worker so that Task `type` is handled. All real logic goes there.

See [PB_TRIGGERS.md](../docs/PB_TRIGGERS.md) for the worked `upload → ingest` example.
