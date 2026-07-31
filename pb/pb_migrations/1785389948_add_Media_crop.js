/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Media: add crop — optional default source crop, a normalized display-frame
// rect { left, top, width, height } in 0–1 fractions (post-rotation, i.e. the
// frame ffmpeg autorotate and browsers decode to). It is the default for
// every placement of the media (strip burned-in letterbox bars); a
// TimelineClip.meta.crop overrides it per placement.
//
// Left bare (no DB-side constraints) on purpose, matching the rotation
// column: shape and bounds are enforced by CropRectSchema at the app layer
// (shared/src/schema/media.ts), and DB bounds would re-open schema drift.
//
// No backfill: an empty JSON column reads as null, which is exactly the
// "no crop" (full frame) default.
// ---------------------------------------------------------------------------
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("Media");

    collection.fields.add(
      new JSONField({
        name: "crop",
        required: false,
      })
    );

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("Media");

    collection.fields.removeByName("crop");

    return app.save(collection);
  }
);
