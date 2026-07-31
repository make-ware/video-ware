/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Ingest backfill trigger
//
// Creates ONE lightweight `ingest_backfill` Task on a schedule. That's all this
// cron does — no work inline. The worker polls the Tasks collection, and
// IngestBackfillService (worker/src/tasks/ingest-backfill.service.ts) runs the
// actual sweep: for every Media it compares the assets a fresh ingest would
// produce (the shared ingest spec) against what the Media holds, and queues a
// `process_upload` task carrying ONLY the steps that are owed. Two things put a
// media in scope:
//
//   1. a missing asset — e.g. media ingested before waveforms existed, and any
//      step added to ingest in the future, and
//   2. an outdated asset — a File stamped with an older ingest version than the
//      current spec (File.meta.ingestVersion vs INGEST_STEP_VERSIONS), so
//      bumping e.g. the proxy spec rolls the library forward automatically.
//
// The sweep is bounded (per-run task and scan caps), skips media with a
// transcode already in flight, and abandons media whose recent transcode
// history is all failures — so a weekly cadence never piles up.
//
// Schedule is "0 2 * * 1" (02:00 every Monday) — deliberately offset from
// storageCleanup (Sundays at 00:00) so the two system tasks don't contend for
// the same worker poll. Trigger on demand from the PocketBase dashboard ->
// Crons -> "ingestBackfill" -> Run.
//
// The task carries no WorkspaceRef/UserRef — it's a system task that operates
// across all workspaces (those fields are optional on Tasks for exactly this).
// The per-media `process_upload` tasks it creates DO carry both, taken from the
// media's upload.
// ---------------------------------------------------------------------------

cronAdd('ingestBackfill', '0 2 * * 1', () => {
  try {
    // Idempotency: skip if a backfill task is already queued or running. A prior
    // failed/succeeded task is NOT active, so the next tick still triggers.
    try {
      $app.findFirstRecordByFilter(
        'Tasks',
        "type = 'ingest_backfill' && (status = 'queued' || status = 'running')"
      );
      console.log('ingestBackfill: active backfill task exists; skipping');
      return; // active backfill task exists -> nothing to do
    } catch (notFound) {
      // No active task -> fall through and create one.
    }

    const tasks = $app.findCollectionByNameOrId('Tasks');
    const task = new Record(tasks);
    task.set('sourceType', 'cron');
    task.set('sourceId', 'ingest-backfill');
    task.set('type', 'ingest_backfill');
    task.set('status', 'queued');
    task.set('progress', 1);
    task.set('attempts', 1);
    task.set('priority', 0);
    // PocketBase treats an empty object {} as blank for a required JSON field, so
    // the payload must be non-empty. The worker ignores the contents for backfill.
    task.set('payload', { scope: 'all' });
    $app.save(task);

    console.log('ingestBackfill: created ingest_backfill task');
  } catch (error) {
    console.error(
      'ingestBackfill: failed to create ingest_backfill task:',
      error
    );
  }
});
