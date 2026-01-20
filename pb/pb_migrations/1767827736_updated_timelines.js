/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_Timelines_add_UserRef_0 = app.findCollectionByNameOrId("Timelines");

  collection_Timelines_add_UserRef_0.fields.add(new RelationField({
    name: "UserRef",
    required: false,
    collectionId: "_pb_users_auth_",
    maxSelect: 1,
    minSelect: 0,
    cascadeDelete: false
  }));

  app.save(collection_Timelines_add_UserRef_0);

  const collection_Timelines_remove_createdBy = app.findCollectionByNameOrId("Timelines");

  collection_Timelines_remove_createdBy.fields.removeByName("createdBy");

  return app.save(collection_Timelines_remove_createdBy);
}, (app) => {
  const collection_Timelines_restore_createdBy = app.findCollectionByNameOrId("Timelines");

  collection_Timelines_restore_createdBy.fields.add(new RelationField({
    name: "createdBy",
    required: false,
    collectionId: "_pb_users_auth_",
    maxSelect: 1,
    minSelect: 0,
    cascadeDelete: false
  }));

  app.save(collection_Timelines_restore_createdBy);

  const collection_Timelines_revert_add_UserRef = app.findCollectionByNameOrId("Timelines");

  collection_Timelines_revert_add_UserRef.fields.removeByName("UserRef");

  return app.save(collection_Timelines_revert_add_UserRef);
});
