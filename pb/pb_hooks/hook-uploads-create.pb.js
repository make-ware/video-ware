/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Upload -> ingest trigger
//
// When an Upload TRANSITIONS INTO the `uploaded` state, create ONE lightweight
// `full_ingest` Task. That's all this hook does — no media creation, no config,
// no HTTP. The worker polls the Tasks collection, and IngestOrchestratorService
// turns the task into a Media record + transcode/labels work.
//
// Registered for both create (external integrations may POST an Upload already
// `uploaded`) and update (the webapp finalize path creates the record as
// `queued` and then UPDATES it to `uploaded` on the last chunk; retry flips
// `failed` -> `uploaded`). The handler is self-contained so PocketBase can
// serialize it for both events.
//
// It only fires on the TRANSITION into `uploaded` (the previous status was
// something else). This lets the stored original be replaced or the record
// edited in place while already `uploaded` — e.g. swapping the media blob for
// a new color grade — WITHOUT re-running the whole transcode + label pipeline.
// `record.original()` is a blank record on create, so an Upload POSTed already
// `uploaded` still counts as a transition and ingests.
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-restricted-syntax -- intentional shared handler: a self-contained top-level function passed directly to both registrations below; PocketBase serializes its full source into each pooled runtime, so it needs no top-level scope at execution time.
function onUploadSaved(e) {
  try {
    const upload = e.record;
    if (upload.get('status') !== 'uploaded') {
      return;
    }

    // Only act on the transition INTO `uploaded`. If it was already `uploaded`
    // before this write, this is an in-place edit (rename, file replace, etc.)
    // and must NOT re-trigger ingest. original() is blank on create, so a
    // create-as-uploaded still passes this check.
    if (upload.original().get('status') === 'uploaded') {
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
