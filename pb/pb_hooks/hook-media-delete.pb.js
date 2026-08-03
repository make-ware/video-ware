/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Media delete lifecycle
//
// Everything that must happen when a Media is deleted lives here, so the behavior
// is identical for ANY caller — webapp, CLI, PocketBase dashboard, raw REST — not
// just MediaService.deleteMedia in the webapp.
//
// Most derived data is reaped by the schema itself: Media's child collections
// (Files, MediaClips, Captions, Label*, LabelJobs, ...) cascade-delete through
// their MediaRef relations (see pb_migrations/*_cascade_* and *_media_cascade),
// and the hook-uploads-delete / hook-files-delete tombstone hooks queue the
// external blobs for the weekly `cleanup` worker task. This file covers only the
// three things a foreign-key
// cascade CANNOT express:
//
//   1. TimelineClips must SURVIVE the delete — a timeline is the user's edit, not
//      derived media data. PocketBase nulls their now-dangling MediaRef /
//      MediaClipRef (both non-cascade) on its own, but it can't set the
//      meta.mediaMissing flag the editor reads to render a "media missing" clip.
//      We set it in a BEFORE-delete hook, while MediaRef still resolves.
//   2. Tasks reference the Media / its Upload by a free-text `sourceId`, not a
//      relation, so there is no FK to cascade through. We delete them after.
//   3. The Upload behind Media.UploadRef is a REVERSE FK (the FK lives on Media,
//      pointing at the Upload), which PB cascade can't follow. We delete it after
//      the Media — which fires hook-uploads-delete to reap the original blob —
//      guarded so a shared Upload is kept while any other Media uses it.
//
// The AFTER-delete handler is best-effort and never throws past e.next(): the
// delete is already durable by then, and a leaked blob / orphaned task is
// reclaimable (the `cleanup` task, or a re-run). See docs/PB_TRIGGERS.md for
// hook discipline.
//
// The BEFORE-delete handler deliberately does NOT swallow. It is the standing
// exception to that rule, because it writes inside the delete's transaction:
// PocketBase surfaces a failure of the delete ITSELF — e.g. a required relation
// it cannot unset — through the first write this handler makes, so catching and
// continuing turned a failed delete into `204 No Content` with the media still
// in the database (verified against a copy of the dev DB: the clips came back
// flagged, the Media row survived, and the only trace was one console line).
// A silent no-op delete is worse than a loud one, and everything the handler
// does before that write is already non-throwing.
//
// PocketBase note: each handler is serialized and executed in an isolated goja
// runtime from the pool, so it CANNOT reference functions or constants from the
// file's top-level scope (that scope only exists during startup registration).
// Everything a handler uses must be defined INSIDE it — hence the per-handler
// PAGE constant and helper functions below.
// ---------------------------------------------------------------------------

// (1) BEFORE delete: preserve referencing timeline clips, flag them mediaMissing.
onRecordDelete((e) => {
  const PAGE = 200;

  // Flag every TimelineClip that points at this media as mediaMissing, preserving
  // the rest of its meta. Runs before the delete so the MediaRef filter still
  // matches; uses e.app so the writes join the delete transaction. Paginates by
  // offset over a stable sort — the clips keep matching (we don't touch MediaRef),
  // so re-reading page 0 would loop forever.
  function flagTimelineClipsMissing(app, mediaId) {
    let offset = 0;
    while (true) {
      const clips = app.findRecordsByFilter(
        'TimelineClips',
        'MediaRef = {:id}',
        'id',
        PAGE,
        offset,
        { id: mediaId }
      );
      if (!clips || clips.length === 0) break;
      for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];
        if (!clip) continue;
        // Read the json field as TEXT, never via get(): PocketBase hands a json
        // field to goja as a types.JsonRaw ([]byte), so `get('meta')` yields a
        // Go slice — typeof 'object', so it slips past an object check, and
        // assigning to it throws "Can't set property 'mediaMissing' on Go
        // slice". That silently broke this flag for every clip (an unset meta
        // is an EMPTY JsonRaw, so it hit the common case, not an edge case).
        // getString() goes through JsonRaw.String() and returns the raw JSON
        // text, or '' when the column is null.
        let meta = {};
        const rawMeta = clip.getString('meta');
        if (rawMeta) {
          try {
            meta = JSON.parse(rawMeta);
          } catch (_) {
            meta = {};
          }
        }
        // A non-object body (array, number, null) can't carry the flag; the
        // editor reads meta as an object, so replace rather than skip.
        if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
          meta = {};
        }
        meta.mediaMissing = true;
        clip.set('meta', meta);
        app.save(clip);
      }
      if (clips.length < PAGE) break;
      offset += clips.length;
    }
  }

  // No try/catch: see the file header. A throw here is a transaction-level
  // failure of the delete, not a bookkeeping slip, and swallowing it reports a
  // success that did not happen.
  flagTimelineClipsMissing(e.app, e.record.id);

  e.next();
}, 'Media');

// (2) + (3) AFTER delete: prune sourceId-keyed Tasks, then the orphaned Upload.
// Post-commit cleanup, so it uses the global $app (the delete is already durable)
// and tolerates anything already gone.
onRecordAfterDeleteSuccess((e) => {
  const PAGE = 200;

  // Delete every Task whose free-text sourceId matches. Re-reads page 0 each loop
  // because deletes shift the result set.
  function deleteTasksBySourceId(app, sourceId) {
    while (true) {
      const tasks = app.findRecordsByFilter(
        'Tasks',
        'sourceId = {:sid}',
        'id',
        PAGE,
        0,
        { sid: sourceId }
      );
      if (!tasks || tasks.length === 0) break;
      for (let i = 0; i < tasks.length; i++) {
        if (tasks[i]) app.delete(tasks[i]);
      }
      if (tasks.length < PAGE) break;
    }
  }

  try {
    const media = e.record;
    const uploadId = media.get('UploadRef');

    // Tasks for the media and (if any) its upload — no FK, so cascade can't.
    try {
      deleteTasksBySourceId($app, media.id);
      if (uploadId) {
        deleteTasksBySourceId($app, uploadId);
      }
    } catch (error) {
      console.error('media-delete: failed to delete tasks:', error);
    }

    if (!uploadId) {
      return; // no upload to cascade to
    }

    // Keep an Upload that another Media still points at. The just-deleted Media
    // is already gone, so this query only sees survivors.
    try {
      $app.findFirstRecordByFilter('Media', 'UploadRef = {:id}', {
        id: uploadId,
      });
      return; // another Media still uses this Upload -> keep it
    } catch (notFound) {
      // No other Media references this Upload -> safe to delete.
    }

    try {
      const upload = $app.findRecordById('Uploads', uploadId);
      $app.delete(upload);
    } catch (notFound) {
      return; // already gone (e.g. deleted out-of-band)
    }
  } catch (error) {
    // A leaked Upload blob is recoverable by the cleanup task; never block.
    console.error('media-delete: failed to delete upload:', error);
  } finally {
    e.next();
  }
}, 'Media');
