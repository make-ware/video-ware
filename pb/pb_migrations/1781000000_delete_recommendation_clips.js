/// <reference path="../pb_data/types.d.ts" />

// The recommendation feature has been removed (see "feat: remove recommendations").
// This migration cleans up the orphaned recommendation data and hardens the
// MediaClips relations so deletes are safe going forward:
//   1. Media -> MediaClips now cascades (deleting a Media deletes its clips).
//   2. Deleting a MediaClip unsets it on TimelineClips (already the case:
//      TimelineClips.MediaClipRef is optional + non-cascade).
//
// Why the previous version crashed production: it deleted recommendation
// MediaClips directly, but TimelineRecommendations references MediaClips via a
// *required* relation (MediaClipRef). PocketBase could neither null the required
// reference (validation fails) nor — because of the UNIQUE index on
// (queryHash, MediaClipRef) — safely empty it, so the delete aborted, the
// migration threw, the boot transaction rolled back, and PocketBase never
// opened :8090. The webapp/worker then saw `ECONNREFUSED 127.0.0.1:8090`.
//
// The fix: delete the dependent recommendation rows FIRST, in dependency order,
// then the clips. Everything below is idempotent and tolerant of already-removed
// collections so it is safe to re-run on boot.

migrate(
  (app) => {
    const collectionExists = (name) => {
      try {
        app.findCollectionByNameOrId(name);
        return true;
      } catch (_) {
        return false;
      }
    };

    // Fetch-and-delete in batches; always read offset 0 since deletes shift the
    // result set. Returns the number of records removed.
    const deleteByFilter = (collectionName, filter) => {
      if (!collectionExists(collectionName)) {
        return 0;
      }
      let removed = 0;
      while (true) {
        const records = app.findRecordsByFilter(
          collectionName,
          filter,
          "",
          500,
          0
        );
        if (!records || records.length === 0) {
          break;
        }
        for (const record of records) {
          if (record) {
            app.delete(record);
            removed++;
          }
        }
        if (records.length < 500) {
          break;
        }
      }
      return removed;
    };

    // 1. Delete dependent recommendation rows first. TimelineRecommendations
    //    holds a *required* relation to MediaClips, so it must be cleared before
    //    the clips or the clip deletes will fail. The recommendation feature is
    //    removed, so all rows in these collections are orphaned.
    deleteByFilter("TimelineRecommendations", "id != ''");
    deleteByFilter("MediaRecommendations", "id != ''");

    // 2. Delete the recommendation-derived MediaClips. The only remaining
    //    reference is TimelineClips.MediaClipRef (optional, non-cascade), which
    //    PocketBase safely unsets.
    deleteByFilter("MediaClips", "type = 'recommendation'");

    // 3. Cascade delete from Media -> MediaClips going forward.
    const mediaClips = app.findCollectionByNameOrId("MediaClips");
    const mediaRef = mediaClips.fields.getByName("MediaRef");
    if (mediaRef && !mediaRef.cascadeDelete) {
      mediaRef.cascadeDelete = true;
      app.save(mediaClips);
    }
  },
  (app) => {
    // Down: deleted rows cannot be restored; only the schema change is reversible.
    try {
      const mediaClips = app.findCollectionByNameOrId("MediaClips");
      const mediaRef = mediaClips.fields.getByName("MediaRef");
      if (mediaRef && mediaRef.cascadeDelete) {
        mediaRef.cascadeDelete = false;
        app.save(mediaClips);
      }
    } catch (_) {
      // MediaClips may not exist on a partial rollback; nothing to revert.
    }
  }
);
