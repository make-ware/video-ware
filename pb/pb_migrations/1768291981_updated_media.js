/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_Media_add_filmstripFileRefs_0 = app.findCollectionByNameOrId("Media");

  collection_Media_add_filmstripFileRefs_0.fields.add(new RelationField({
    name: "filmstripFileRefs",
    required: false,
    collectionId: "pb_48ql3az7t9ok2mu",
    maxSelect: 999,
    minSelect: 0,
    cascadeDelete: false
  }));

  app.save(collection_Media_add_filmstripFileRefs_0);

  const collection_Media_add_audioFileRef_1 = app.findCollectionByNameOrId("Media");

  collection_Media_add_audioFileRef_1.fields.add(new RelationField({
    name: "audioFileRef",
    required: false,
    collectionId: "pb_48ql3az7t9ok2mu",
    maxSelect: 1,
    minSelect: 0,
    cascadeDelete: false
  }));

  app.save(collection_Media_add_audioFileRef_1);

  const collection_Media_modify_duration = app.findCollectionByNameOrId("Media");
  const collection_Media_modify_duration_field = collection_Media_modify_duration.fields.getByName("duration");

  collection_Media_modify_duration_field.required = false;

  return app.save(collection_Media_modify_duration);
}, (app) => {
  const collection_Media_revert_duration = app.findCollectionByNameOrId("Media");
  const collection_Media_revert_duration_field = collection_Media_revert_duration.fields.getByName("duration");

  collection_Media_revert_duration_field.required = true;

  app.save(collection_Media_revert_duration);

  const collection_Media_revert_add_filmstripFileRefs = app.findCollectionByNameOrId("Media");

  collection_Media_revert_add_filmstripFileRefs.fields.removeByName("filmstripFileRefs");

  app.save(collection_Media_revert_add_filmstripFileRefs);

  const collection_Media_revert_add_audioFileRef = app.findCollectionByNameOrId("Media");

  collection_Media_revert_add_audioFileRef.fields.removeByName("audioFileRef");

  return app.save(collection_Media_revert_add_audioFileRef);
});
