/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Files -> Artifacts tombstone
//
// PocketBase's cascadeDelete (Files.MediaRef) removes File records and PB-native
// blobs when a Media is deleted, but it never deletes the *external* blob behind
// Files.storageKey (S3/GCS, or a local-backend key) — those objects leak.
//
// This hook fires after a File record is deleted (whether directly or via cascade
// from its Media) and, if the file had an external storage key, records that key
// in the Artifacts collection. The `cleanup` worker task drains Artifacts
// and deletes the blobs via the shared StorageBackend.
//
// PB-native files (fileSource = pocketbase, no storageKey) are deleted by
// PocketBase itself, so we only tombstone files that carry a storageKey.
// ---------------------------------------------------------------------------

onRecordAfterDeleteSuccess((e) => {
  try {
    const file = e.record;
    const fileSource = file.get('fileSource');
    if (!fileSource || fileSource === 'pocketbase') {
      return; // PB-native blob -> nothing to reap
    }

    const storageKey = file.get('storageKey');
    if (!storageKey) {
      return; // PB-native blob (or nothing stored externally) -> nothing to reap
    }

    const artifacts = $app.findCollectionByNameOrId('Artifacts');
    const artifact = new Record(artifacts);
    artifact.set('storageKey', storageKey);
    artifact.set('fileSource', file.get('fileSource') || 's3');
    artifact.set('status', 'pending');
    artifact.set('reason', 'file_deleted');
    artifact.set('sourceCollection', 'Files');
    artifact.set('sourceId', file.id);
    artifact.set('attempts', 0);
    const workspaceRef = file.get('WorkspaceRef');
    if (workspaceRef) {
      artifact.set('WorkspaceRef', workspaceRef);
    }
    $app.save(artifact);
  } catch (error) {
    // Never block the delete because of tombstone bookkeeping; just log. A leaked
    // blob is recoverable, a wedged delete is not.
    console.error('files-delete: failed to record artifact:', error);
  } finally {
    e.next();
  }
}, 'Files');
