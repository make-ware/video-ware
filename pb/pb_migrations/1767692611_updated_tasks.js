/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_Tasks_add_UserRef = app.findCollectionByNameOrId("Tasks");

  collection_Tasks_add_UserRef.fields.add(new RelationField({
    name: "UserRef",
    required: true,
    collectionId: "_pb_users_auth_",
    maxSelect: 1,
    minSelect: 0,
    cascadeDelete: false
  }));

  return app.save(collection_Tasks_add_UserRef);
}, (app) => {
  const collection_Tasks_revert_add_UserRef = app.findCollectionByNameOrId("Tasks");

  collection_Tasks_revert_add_UserRef.fields.removeByName("UserRef");

  return app.save(collection_Tasks_revert_add_UserRef);
});
