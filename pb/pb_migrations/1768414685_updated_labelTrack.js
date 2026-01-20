/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_LabelTrack_remove_TaskRef = app.findCollectionByNameOrId("LabelTrack");

  collection_LabelTrack_remove_TaskRef.fields.removeByName("TaskRef");

  return app.save(collection_LabelTrack_remove_TaskRef);
}, (app) => {
  const collection_LabelTrack_restore_TaskRef = app.findCollectionByNameOrId("LabelTrack");

  collection_LabelTrack_restore_TaskRef.fields.add(new RelationField({
    name: "TaskRef",
    required: false,
    collectionId: app.findCollectionByNameOrId("pb_rm2tsf1ujhh49zr").id,
    maxSelect: 1,
    minSelect: 0,
    cascadeDelete: false
  }));

  return app.save(collection_LabelTrack_restore_TaskRef);
});
