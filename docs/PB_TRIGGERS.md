# Database Triggers & the Task Contract

The database is the source of truth. Background work is driven by **records**, not
by direct calls into the worker. Clients (the webapp *or* any external integration)
make simple writes to PocketBase; lightweight PocketBase hooks turn those writes into
**Task** records; and the NestJS worker owns all the application logic.

```
client write (PB REST)  ──►  PocketBase hook (dumb)  ──►  Tasks collection  ──►  worker
   e.g. Upload -> uploaded     create one Task row         (source of truth)      polls + acts
```

Two rules keep this maintainable:

1. **Hooks stay dumb.** A hook may read a few fields and create a Task row. No media
   creation, no config building, no HTTP, no external calls. PocketBase runs an ES5
   (goja) engine without `fetch`/`fs`/`setTimeout` — see [PB_EXTENDING.md](PB_EXTENDING.md).
2. **The worker is the brain.** All processing, fan-out, retries, and external API
   calls live in the worker (`worker/src/...`), triggered by Task records.

## The Tasks collection

`Tasks` is the queue and the audit log. Key fields:

| Field          | Meaning                                                              |
| -------------- | -------------------------------------------------------------------- |
| `type`         | `full_ingest`, `process_upload`, `detect_labels`, `render_timeline`  |
| `sourceType`   | `upload` \| `Media` \| `Timeline`                                    |
| `sourceId`     | id of the source record                                              |
| `status`       | `queued` → `running` → `success` \| `failed` \| `canceled`           |
| `payload`      | JSON input for the worker                                            |
| `result`       | JSON output written by the worker                                   |
| `WorkspaceRef` / `UserRef` | ownership                                               |

The worker (`TaskEnqueuerService`) polls for `status = queued` tasks every ~5s and acts
on them. Creating a Task row — by any means — is therefore enough to start work.

## Reference trigger: upload → ingest

This is the canonical pattern; new triggers should follow its shape.

**Contract for clients (including external integrations):**

1. Create an `Uploads` record and place the file bytes at `externalPath` /
   `storageBackend` (the webapp does this via its chunked upload route; see
   [PB_UPLOADS.md](PB_UPLOADS.md)). Optionally set `DirectoryRef` to choose where the
   resulting Media lands.
2. Set the upload's `status` to `uploaded`.

That's the whole API. No call to the worker, no Media creation by the client.

**What the system does:**

- A hook on `Uploads` (`pb/pb_hooks/main.pb.js`, registered for both create and update
  success) fires when `status === "uploaded"`. If no *active* ingest task already exists
  for that upload, it creates **one** `full_ingest` Task (`payload = { uploadId }`).
- The worker's `IngestOrchestratorService` (`worker/src/tasks/ingest-orchestrator.service.ts`)
  picks the task up and:
  1. creates a placeholder `Media` record (idempotent; reused on retry),
  2. builds the default transcode/labels config from the file type, and
  3. fans out a `process_upload` (transcode) task and, for non-image media with a known
     file path, a `detect_labels` task — each its own BullMQ flow.
- The `full_ingest` task is marked `success` once the children are enqueued.

The webapp's media library updates automatically because it subscribes to `Media`
realtime (see [PB_REALTIME.md](PB_REALTIME.md)) — the placeholder Media appears as soon
as the worker creates it.

**Idempotency & retries.** The hook only creates a task when there is no `queued`/`running`
`full_ingest` task for the upload, so repeated updates don't duplicate work. A prior
`failed`/`success` task is not "active", so re-setting a failed upload back to `uploaded`
(how `retryUpload` works) re-triggers a fresh ingest. The worker reuses any existing Media.

### Example: drive ingest entirely via the REST API

```bash
# 1. Create the upload record (file staged out-of-band at externalPath)
curl -X POST "$PB_URL/api/collections/Uploads/records" \
  -H "Authorization: $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "name": "clip.mp4",
    "size": 12345678,
    "status": "uploaded",
    "storageBackend": "s3",
    "externalPath": "workspace-1/clip.mp4",
    "WorkspaceRef": "<workspace_id>",
    "UserRef": "<user_id>"
  }'
# The onRecordAfterCreateSuccess hook creates the full_ingest task; the worker ingests.
```

## Reference trigger: timeline render

The same pattern drives timeline renders, with the `TimelineRender` record as the
source of truth for the whole render (input + lifecycle):

1. The client creates a `TimelineRenders` record carrying the render input
   (`timelineData` = the resolved tracks, `outputSettings` = resolution/codec/format/…)
   plus `TimelineRef`, `WorkspaceRef`, `UserRef`, and `status='queued'`. `FileRef` is
   left empty — the worker fills it in.
2. An `onRecordAfterCreateSuccess` hook on `TimelineRenders` creates one
   `render_timeline` Task (`payload = { timelineRenderId }`), `sourceId = <renderId>`.
3. The worker (in `TaskEnqueuerService.prepareRenderTask`) reads the render entity,
   assembles the full render payload, flips the entity to `running`, and enqueues the
   BullMQ render flow. The FINALIZE step writes `FileRef` + `status='success'` back onto
   the same record; a failure flips it to `failed` (via `RenderParentProcessor.onParentFailed`).

Because the entity exists from creation, its id is stable and the UI tracks progress
directly on it (queued → running → success/failed) via realtime — no need to correlate a
separate task. A re-render is simply a new `TimelineRenders` record.

## Adding a new trigger

1. Decide the source write that should start work (a status change, a new record, …).
2. Add a small hook in `pb/pb_hooks/main.pb.js` that, on that event, creates a single
   Task row of the appropriate `type`. Keep the handler self-contained and never let it
   throw past `e.next()`.
3. Implement/extend the worker so that Task `type` is handled — either a BullMQ flow
   (`QueueService.enqueueTask`) or an orchestrator like `IngestOrchestratorService` that
   fans out to existing task types. All real logic goes here.
