/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// LabelTrack: add labelType — a denormalized copy of the track's cluster type
// (LabelEntityRef -> LabelEntity.labelType).
//
// LabelTrack is one collection for every label kind, and it had no type
// column: the only way to ask "give me this media's speaker tracks" was to
// page every track for the media and traverse LabelEntityRef.labelType. On a
// media with 649 tracks (object tracking alone emits 100+ per dense minute)
// the speaker identification UI's single 500-row page silently dropped the
// three speaker tracks and rendered "No track record", making the speakers
// impossible to tag.
//
// With this field plus idx_label_track_media_type, that becomes a three-row
// indexed lookup. Safe to denormalize: a cluster's labelType is assigned when
// the LabelEntity is created and never changes afterwards.
//
// Optional (required: false) because a track written without a LabelEntityRef
// has no type to inherit; the backfill leaves those as "".
// ---------------------------------------------------------------------------

const MEDIA_TYPE_INDEX =
  "CREATE INDEX idx_label_track_media_type ON LabelTrack (MediaRef, labelType)";

// Every LabelType value (shared/src/enums.ts) — PocketBase rejects an insert
// carrying a select value that isn't listed here.
const LABEL_TYPE_VALUES = [
  "object",
  "shot",
  "person",
  "speech",
  "speaker",
  "face",
  "segment",
  "text",
];

migrate((app) => {
  const collection = app.findCollectionByNameOrId("LabelTrack");

  collection.fields.add(new SelectField({
    name: "labelType",
    required: false,
    maxSelect: 1,
    values: LABEL_TYPE_VALUES,
  }));

  collection.indexes = collection.indexes
    .filter((idx) => idx !== MEDIA_TYPE_INDEX)
    .concat([MEDIA_TYPE_INDEX]);

  app.save(collection);

  // Backfill existing rows from their cluster. Must run after the save above —
  // the column does not exist until then. One static statement rather than a
  // record loop: this touches every LabelTrack in the database.
  //
  // Never throw: a failed boot migration rolls back startup and PocketBase
  // never opens its port. An unbackfilled row degrades to the legacy lookup
  // path in the UI, which is survivable; an unbootable server is not.
  try {
    app.db().newQuery(`
      UPDATE LabelTrack
         SET labelType = COALESCE(
               (SELECT le.labelType
                  FROM LabelEntity le
                 WHERE le.id = LabelTrack.LabelEntityRef),
               ''
             )
       WHERE COALESCE(labelType, '') = ''
    `).execute();
  } catch (err) {
    console.log("LabelTrack.labelType backfill failed (non-fatal): " + err);
  }

  return null;
}, (app) => {
  const collection = app.findCollectionByNameOrId("LabelTrack");

  collection.indexes = collection.indexes.filter(
    (idx) => idx !== MEDIA_TYPE_INDEX
  );

  collection.fields.removeByName("labelType");

  return app.save(collection);
});
