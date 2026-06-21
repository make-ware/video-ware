/// <reference path="../pb_data/types.d.ts" />

// Cascade delete a Media's derived files.
//
// Files (proxy, filmstrip, sprite, thumbnail, audio, ...) point back to their
// Media via Files.MediaRef. Turning on cascadeDelete makes PocketBase remove
// those File records — and their stored blobs (local or S3) — when the Media is
// deleted.
//
// This migration ONLY flips the schema flag — it does not touch any rows, so it
// can't fail on bad data at boot. The cascade deletes files whose MediaRef is
// set; new files set it at creation (worker). Existing files that predate that
// can be linked on demand via the `backfillFileMediaRefs` cron in
// pb_hooks/media-files-backfill.pb.js (scheduled to never run — trigger it
// manually from the dashboard's Crons page when there is data to backfill).

migrate(
  (app) => {
    const files = app.findCollectionByNameOrId('Files');
    const mediaRef = files.fields.getByName('MediaRef');
    if (mediaRef && !mediaRef.cascadeDelete) {
      mediaRef.cascadeDelete = true;
      app.save(files);
    }
  },
  (app) => {
    try {
      const files = app.findCollectionByNameOrId('Files');
      const mediaRef = files.fields.getByName('MediaRef');
      if (mediaRef && mediaRef.cascadeDelete) {
        mediaRef.cascadeDelete = false;
        app.save(files);
      }
    } catch (_) {
      // Files may not exist on a partial rollback; nothing to revert.
    }
  }
);
