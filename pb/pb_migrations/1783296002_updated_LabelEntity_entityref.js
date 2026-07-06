/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// LabelEntity: add EntityRef — the workspace-wide semantic link to a
// real-world Entity (1783296000_created_Entities).
//
// A LabelEntity is a provider-generated cluster ("iPhone" object labels,
// on-screen text, the shared "Face" bucket). Linking it to an Entity
// attributes every label row in the cluster, across all media, in one step —
// the right granularity for objects and text where provider names are
// stable. For faces and speakers the per-media LabelTrack.EntityRef
// (1783296001) is the right link point and takes precedence over this one.
//
// No cascade: deleting an Entity clears EntityRef here.
// ---------------------------------------------------------------------------

const ENTITY_INDEX =
  "CREATE INDEX idx_label_entity_entity ON LabelEntity (EntityRef)";

migrate((app) => {
  const collection = app.findCollectionByNameOrId("LabelEntity");

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
  const collection = app.findCollectionByNameOrId("LabelEntity");

  collection.fields.removeByName("EntityRef");

  collection.indexes = collection.indexes.filter(
    (idx) => idx !== ENTITY_INDEX
  );

  return app.save(collection);
});
