/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Media -> Upload cascade delete
//
// A Media is created from exactly one Upload (Media.UploadRef). PocketBase's
// native cascadeDelete only flows from the relation HOLDER to its target's
// children — here the FK lives on Media pointing AT the Upload, so PB can delete
// a Media when its Upload goes, but never the reverse. Deleting a Media therefore
// leaves the Upload record (and its original blob under uploads/{ws}/{uploadId}/)
// orphaned. The derived Files are already reaped via Files.MediaRef cascadeDelete
// + the files-artifact-tombstone hook; this closes the same gap for the Upload.
//
// After a Media is deleted we delete its Upload, which in turn fires the
// uploads-artifact-tombstone hook to queue the original blob for reaping by the
// `cleanup` worker task. Guarded: if any OTHER Media still references the same
// Upload, we leave the Upload (and its blob) alone.
// ---------------------------------------------------------------------------

onRecordAfterDeleteSuccess((e) => {
  try {
    const media = e.record;
    const uploadId = media.get('UploadRef');
    if (!uploadId) {
      return; // no upload to cascade to
    }

    // Don't delete an Upload that another Media still points at. The just-deleted
    // Media is already gone, so this query only sees survivors.
    try {
      $app.findFirstRecordByFilter('Media', 'UploadRef = {:id}', {
        id: uploadId,
      });
      return; // another Media still uses this Upload -> keep it
    } catch (notFound) {
      // No other Media references this Upload -> safe to delete.
    }

    let upload;
    try {
      upload = $app.findRecordById('Uploads', uploadId);
    } catch (notFound) {
      return; // already gone (e.g. the webapp delete path removed it first)
    }
    $app.delete(upload);
  } catch (error) {
    // Best-effort: a leaked Upload blob is recoverable by the cleanup task; a
    // wedged Media delete is not. Never block the delete on this bookkeeping.
    console.error('media-uploads-cascade: failed to delete upload:', error);
  } finally {
    e.next();
  }
}, 'Media');
