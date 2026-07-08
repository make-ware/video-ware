/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Upload -> ingest trigger
//
// When an Upload reaches the `uploaded` state, create ONE lightweight
// `full_ingest` Task. That's all this hook does — no media creation, no config,
// no HTTP. The worker polls the Tasks collection, and IngestOrchestratorService
// turns the task into a Media record + transcode/labels work.
//
// Registered for both create (external integrations may POST an Upload already
// `uploaded`) and update (the webapp finalize + retry path). The handler is
// self-contained so PocketBase can serialize it for both events.
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-restricted-syntax -- intentional shared handler: a self-contained top-level function passed directly to both registrations below; PocketBase serializes its full source into each pooled runtime, so it needs no top-level scope at execution time.
function onUploadSaved(e) {
  try {
    const upload = e.record;
    if (upload.get('status') !== 'uploaded') {
      return;
    }

    const uploadId = upload.id;

    // Idempotency: skip if an ingest task for this upload is already active.
    // A prior failed/succeeded task is NOT active, so retries still trigger.
    try {
      $app.findFirstRecordByFilter(
        'Tasks',
        "sourceId = {:id} && type = 'full_ingest' && (status = 'queued' || status = 'running')",
        { id: uploadId }
      );
      return; // active ingest task exists -> nothing to do
    } catch (notFound) {
      // No active task -> fall through and create one.
    }

    const tasks = $app.findCollectionByNameOrId('Tasks');
    const task = new Record(tasks);
    task.set('sourceType', 'upload');
    task.set('sourceId', uploadId);
    task.set('type', 'full_ingest');
    task.set('status', 'queued');
    task.set('progress', 1);
    task.set('attempts', 1);
    task.set('priority', 0);
    task.set('payload', { uploadId: uploadId });
    task.set('WorkspaceRef', upload.get('WorkspaceRef'));
    task.set('UserRef', upload.get('UserRef'));
    $app.save(task);
  } catch (error) {
    // Never block the Upload write because of task creation.
    console.error('Failed to create full_ingest task for upload:', error);
  } finally {
    e.next();
  }
}

onRecordAfterCreateSuccess(onUploadSaved, 'Uploads');
onRecordAfterUpdateSuccess(onUploadSaved, 'Uploads');
