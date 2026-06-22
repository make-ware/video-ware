/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Media -> child collections cascade delete
//
// Push the "delete a Media -> delete its derived data" rule into the schema so
// it holds no matter who issues the delete (webapp, CLI, PocketBase dashboard,
// raw API). Previously only MediaService.deleteMedia in the webapp removed these
// children before deleting the Media; anything else (notably the CLI) left them
// orphaned, and a direct Media delete failed outright because these MediaRef
// relations are `required` (PocketBase refuses to orphan a required relation).
//
// Each collection below points at Media via a `MediaRef` relation. Turning on
// cascadeDelete makes PocketBase delete those rows when their Media is deleted.
// External storage blobs behind the cascaded rows (e.g. Files.storageKey) are
// still reaped by the artifact-tombstone hooks + the weekly `cleanup` task.
//
// Already handled by earlier migrations, so intentionally NOT touched here:
//   - Files        (1781700000_updated_Files_media_cascade)
//   - MediaClips    (1781000000_delete_recommendation_clips)
//   - Captions      (created with cascadeDelete: true)
//
// Deliberately EXCLUDED — must stay non-cascade:
//   - TimelineClips. A timeline is the user's edit; it must survive deletion of
//     its source media. When the Media (and its MediaClips) are deleted,
//     PocketBase clears the now-dangling TimelineClips.MediaRef / MediaClipRef
//     (both non-cascade) instead of removing the clip. The webapp additionally
//     sets meta.mediaMissing for UX, which the DB cascade does not do — the clip
//     simply ends up with empty media refs, which the UI already treats as a
//     missing-media clip.
//
// NOT covered by this (no foreign key to cascade through):
//   - Tasks reference Media/Upload via a free-text `sourceId`, not a relation,
//     so they cannot cascade. Callers that care about pruning task history must
//     still delete those explicitly.
//
// Boot safety: every collection is guarded individually. A missing collection or
// field is skipped, never thrown — a migration that throws on boot rolls back the
// whole startup transaction and PocketBase never opens its port (the failure mode
// that took down 1781000000's first cut). The flip is idempotent: it only writes
// when cascadeDelete is currently false.
// ---------------------------------------------------------------------------

const MEDIA_CHILD_COLLECTIONS = [
  'LabelShots',
  'LabelFaces',
  'LabelPerson',
  'LabelObjects',
  'LabelSegments',
  'LabelSpeech',
  'LabelTrack',
  'LabelText',
  'LabelJobs',
  'MediaRecommendations',
];

function setMediaRefCascade(app, cascade) {
  for (const name of MEDIA_CHILD_COLLECTIONS) {
    try {
      const collection = app.findCollectionByNameOrId(name);
      const mediaRef = collection.fields.getByName('MediaRef');
      if (mediaRef && mediaRef.cascadeDelete !== cascade) {
        mediaRef.cascadeDelete = cascade;
        app.save(collection);
      }
    } catch (_) {
      // Collection or field absent (already removed, partial rollback) -> skip.
      // Never throw: a boot-time migration failure rolls back startup entirely.
    }
  }
}

migrate(
  (app) => {
    setMediaRefCascade(app, true);
  },
  (app) => {
    setMediaRefCascade(app, false);
  }
);
