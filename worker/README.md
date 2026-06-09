# @project/worker

NestJS + BullMQ background worker for media processing. Consumes four Redis-backed
queues — `TRANSCODE`, `RENDER`, `LABELS`, `INTELLIGENCE` — using parent/child job
flows. Jobs are idempotent: execution state lives in PocketBase and on a
deterministic filesystem layout, never in the job payload, so a job can be retried
or re-run safely.

## Scaling & concurrency

The primary scaling lever is **per-queue BullMQ worker concurrency** within a single
pod. Each queue's concurrency is read from config at startup and applied to its
worker (see [`base-flow.processor.ts`](src/queue/processors/base-flow.processor.ts)
and [`configuration.ts`](src/config/configuration.ts)).

| Env var | Default | Notes |
| --- | --- | --- |
| `WORKER_CONCURRENCY` | – | Global fallback for every queue |
| `WORKER_CONCURRENCY_TRANSCODE` | `3` | CPU-bound (ffmpeg) — keep modest |
| `WORKER_CONCURRENCY_RENDER` | `2` | CPU-bound (ffmpeg) — keep modest |
| `WORKER_CONCURRENCY_LABELS` | `5` | IO/API-bound (GCS + Video Intelligence) |
| `WORKER_CONCURRENCY_INTELLIGENCE` | `5` | IO/API-bound |
| `WORKER_LOCK_DURATION_MS` | `60000` | Lock TTL; long ffmpeg jobs must not be marked "stalled". BullMQ auto-renews while the process is alive. |

Concurrency is safe because services are stateless singletons and all working files
use deterministic, task-scoped paths (keyed by `uploadId` / `taskId` / `mediaId`), so
concurrent jobs never collide.

### Running multiple pods (horizontal scaling)

Redis guarantees a job runs on only one worker, so horizontal scaling works — with
one caveat about local disk:

- **Transcode & Labels — multi-pod safe with no shared disk.** Each step re-resolves
  its inputs from storage (S3) or GCS independently.
- **Render — needs a single pod _or_ a shared RWX volume.** The render flow chains
  through local disk: `PREPARE` downloads/symlinks clip inputs into
  `<WORKER_DATA_DIR>/renders/<workspaceId>/<taskId>/`, `EXECUTE` reads that directory,
  and `FINALIZE` reads the output. These run as separate jobs that may land on
  different pods. Run render on one pod, or give all worker pods a shared
  `ReadWriteMany` volume for the render directory.

Recommended multi-pod setup (S3 mode):

- `STORAGE_TYPE=s3`, `ENABLE_S3_MIGRATION=false` on all pods.
- Run the periodic task enqueuer on exactly one pod (`ENABLE_TASK_ENQUEUER=true`) and
  set `ENABLE_TASK_ENQUEUER=false` on the rest. (Duplicate enqueues are deduped by
  BullMQ `jobId` regardless, so this is an efficiency choice, not a correctness one.)
- Set `terminationGracePeriodSeconds` ≥ your longest expected job so k8s does not
  `SIGKILL` a pod mid-transcode. NestJS shutdown hooks close the BullMQ workers,
  which stop pulling new jobs and wait for in-flight ones to finish.

## Statelessness & disk cleanup

In **S3 mode** the worker is designed to leave no local state behind:

- Each step removes its own local **output** file after upload via a `finally` block,
  so failures don't leak (see the `*-step.processor.ts` files).
- After a task settles (success *or* failure), the parent processor removes shared
  working artifacts: the transcode source download (`worker-temp/<uploadId>`), the
  render working directory, and per-clip render downloads. See
  `cleanupTaskArtifacts` in [`base-flow.processor.ts`](src/queue/processors/base-flow.processor.ts)
  and the render override in
  [`render-parent.processor.ts`](src/task-render/processors/render-parent.processor.ts).
- `ENABLE_S3_MIGRATION=false` (default) skips the startup local→S3 migration scan.

In **local mode** these cleanups are no-ops: outputs and render directories live under
`WORKER_DATA_DIR`, which is the durable store, so files are intentionally preserved.

## Storage

| Env var | Notes |
| --- | --- |
| `STORAGE_TYPE` | `local` (default) or `s3` |
| `WORKER_DATA_DIR` | Base path for local storage / render working dirs |
| `ENABLE_S3_MIGRATION` | One-time local→S3 migration on boot (default `false`) |
| `S3_*` | Bucket / region / endpoint / credentials (see `shared` env schema) |
