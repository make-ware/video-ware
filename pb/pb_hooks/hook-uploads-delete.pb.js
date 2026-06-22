/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Uploads -> Artifacts tombstone
//
// The original (untouchable) blob behind an Upload lives in the storage backend
// at Upload.externalPath (e.g. "uploads/{ws}/{uploadId}/original.mov" — an S3/GCS
// key, or a local-backend key under ./data). PocketBase has no record of that
// external blob, so deleting an Upload never reclaims it; the blob leaks.
//
// This hook fires after an Upload record is deleted (directly, or via the
// hook-media-delete hook when its Media is removed) and records the original
// blob's key in the Artifacts collection. The `cleanup` worker task drains
// Artifacts and deletes the blob via the shared StorageBackend (which, on the
// local backend, also prunes the now-empty uploads/{ws}/{uploadId}/ directory).
//
// Mirrors hook-files-delete.pb.js, but keyed on Upload.externalPath rather
// than Files.storageKey. Uploads that never finished (no externalPath) have no
// blob to reap and are skipped.
// ---------------------------------------------------------------------------

onRecordAfterDeleteSuccess((e) => {
  try {
    const upload = e.record;

    const storageKey = upload.get('externalPath');
    if (!storageKey) {
      return; // nothing stored externally -> nothing to reap
    }

    // Artifacts.fileSource is observability-only — the cleanup task reaps via the
    // worker's single configured backend, not this value — so just mirror the
    // Upload's storageBackend onto the allowed FileSource values.
    const fileSource =
      upload.get('storageBackend') === 's3' ? 's3' : 'pocketbase';

    const artifacts = $app.findCollectionByNameOrId('Artifacts');
    const artifact = new Record(artifacts);
    artifact.set('storageKey', storageKey);
    artifact.set('fileSource', fileSource);
    artifact.set('status', 'pending');
    artifact.set('reason', 'upload_deleted');
    artifact.set('sourceCollection', 'Uploads');
    artifact.set('sourceId', upload.id);
    artifact.set('attempts', 0);
    const workspaceRef = upload.get('WorkspaceRef');
    if (workspaceRef) {
      artifact.set('WorkspaceRef', workspaceRef);
    }
    $app.save(artifact);
  } catch (error) {
    // Never block the delete because of tombstone bookkeeping; just log. A leaked
    // blob is recoverable, a wedged delete is not.
    console.error('uploads-delete: failed to record artifact:', error);
  } finally {
    e.next();
  }
}, 'Uploads');
