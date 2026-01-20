/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_Tasks_add_priority_0 = app.findCollectionByNameOrId("Tasks");

  collection_Tasks_add_priority_0.fields.add(new NumberField({
    name: "priority",
    required: false
  }));

  app.save(collection_Tasks_add_priority_0);

  const collection_Tasks_add_UserRef_1 = app.findCollectionByNameOrId("Tasks");

  collection_Tasks_add_UserRef_1.fields.add(new RelationField({
    name: "UserRef",
    required: true,
    collectionId: "_pb_users_auth_",
    maxSelect: 1,
    minSelect: 0,
    cascadeDelete: false
  }));

  return app.save(collection_Tasks_add_UserRef_1);
}, (app) => {
  const collection_Tasks_revert_add_priority = app.findCollectionByNameOrId("Tasks");

  collection_Tasks_revert_add_priority.fields.removeByName("priority");

  app.save(collection_Tasks_revert_add_priority);

  const collection_Tasks_revert_add_UserRef = app.findCollectionByNameOrId("Tasks");

  collection_Tasks_revert_add_UserRef.fields.removeByName("UserRef");

  return app.save(collection_Tasks_revert_add_UserRef);
});
