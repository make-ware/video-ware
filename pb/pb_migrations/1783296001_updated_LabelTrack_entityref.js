/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// LabelTrack: add EntityRef — the per-media instance link to a real-world
// Entity (1783296000_created_Entities).
//
// A track is the per-media label cluster (one GCVI face track, one diarized
// speaker), so setting EntityRef is the "this track is Erik" operation.
// Assigning several tracks — across media, or within one media when the
// provider loses the identity and starts a new track — to the same Entity is
// what identifies a person/product across footage. Track-level links take
// precedence over the workspace-wide LabelEntity.EntityRef fallback
// (1783296002).
//
// No cascade: deleting an Entity clears EntityRef on its tracks; deleting a
// track never touches the Entity. Track rows are stable across label re-runs
// (processors dedup by trackHash), so manual links survive regeneration.
// ---------------------------------------------------------------------------

const ENTITY_INDEX =
  "CREATE INDEX idx_label_track_entity ON LabelTrack (EntityRef)";

migrate((app) => {
  const collection = app.findCollectionByNameOrId("LabelTrack");

  collection.fields.add(new RelationField({
    name: "EntityRef",
    required: false,
    collectionId: "pb_entity1a2b3c4d5", // Entities
    maxSelect: 1,
    minSelect: 0,
    cascadeDelete: false,
  }));

  collection.indexes = collection.indexes
    .filter((idx) => idx !== ENTITY_INDEX)
    .concat([ENTITY_INDEX]);

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("LabelTrack");

  collection.fields.removeByName("EntityRef");

  collection.indexes = collection.indexes.filter(
    (idx) => idx !== ENTITY_INDEX
  );

  return app.save(collection);
});
