/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Storage cleanup trigger
//
// Creates ONE lightweight `cleanup` Task on a schedule. That's all this cron does
// — no work inline. The worker polls the Tasks collection, and
// CleanupOrchestratorService runs the actual maintenance:
//   1. backfill missing Files.MediaRef links (legacy files that predate the
//      worker setting MediaRef at creation),
//   2. prune stale File records (soft-deleted / failed),
//   3. reap orphaned external storage blobs queued in the Artifacts collection
//      (the cascade-delete gap: PocketBase deletes File records but not their
//      external S3/GCS blobs), and
//   4. delete stale worker working directories.
//
// Schedule is currently "0 0 * * 0" (00:00 every Sunday) but may change. The task
// is idempotent and cheap when there's nothing to do. Trigger on demand from the
// PocketBase dashboard -> Crons -> "storageCleanup" -> Run.
//
// The task carries no WorkspaceRef/UserRef — it's a system task that operates
// across all workspaces (those fields are optional on Tasks for exactly this).
// ---------------------------------------------------------------------------

cronAdd('storageCleanup', '0 0 * * 0', () => {
  try {
    // Idempotency: skip if a cleanup task is already queued or running. A prior
    // failed/succeeded task is NOT active, so the next tick still triggers.
    try {
      $app.findFirstRecordByFilter(
        'Tasks',
        "type = 'cleanup' && (status = 'queued' || status = 'running')"
      );
      console.log('storageCleanup: active cleanup task exists; skipping');
      return; // active cleanup task exists -> nothing to do
    } catch (notFound) {
      // No active task -> fall through and create one.
    }

    const tasks = $app.findCollectionByNameOrId('Tasks');
    const task = new Record(tasks);
    task.set('sourceType', 'cron');
    task.set('sourceId', 'storage-cleanup');
    task.set('type', 'cleanup');
    task.set('status', 'queued');
    task.set('progress', 1);
    task.set('attempts', 1);
    task.set('priority', 0);
    // PocketBase treats an empty object {} as blank for a required JSON field, so
    // the payload must be non-empty. The worker ignores the contents for cleanup.
    task.set('payload', { scope: 'all' });
    $app.save(task);

    console.log('storageCleanup: created cleanup task');
  } catch (error) {
    console.error('storageCleanup: failed to create cleanup task:', error);
  }
});
