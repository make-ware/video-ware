/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // The 'composite' ClipType is retired: a clip is composite iff its
    // clipData.segments edit list is active (>= 2 segments); `type` is purely
    // the clip's origin (user/shot/face/…). Rows flipped to 'composite' by
    // the old destructive segment editing were user-initiated edits, so they
    // become 'user' — their edit lists are untouched and keep working.
    app
      .db()
      .newQuery("UPDATE MediaClips SET type = 'user' WHERE type = 'composite'")
      .execute();
  },
  () => {
    // Irreversible: the pre-conversion origin type was overwritten by the
    // old destructive flip; there is nothing to restore.
  }
);
