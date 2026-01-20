/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_Timelines_add_timelineData_0 = app.findCollectionByNameOrId("Timelines");

  collection_Timelines_add_timelineData_0.fields.add(new JSONField({
    name: "timelineData",
    required: false
  }));

  app.save(collection_Timelines_add_timelineData_0);

  const collection_Timelines_modify_version = app.findCollectionByNameOrId("Timelines");
  const collection_Timelines_modify_version_field = collection_Timelines_modify_version.fields.getByName("version");

  collection_Timelines_modify_version_field.min = undefined;

  app.save(collection_Timelines_modify_version);

  const collection_Timelines_remove_editList = app.findCollectionByNameOrId("Timelines");

  collection_Timelines_remove_editList.fields.removeByName("editList");

  return app.save(collection_Timelines_remove_editList);
}, (app) => {
  const collection_Timelines_restore_editList = app.findCollectionByNameOrId("Timelines");

  collection_Timelines_restore_editList.fields.add(new JSONField({
    name: "editList",
    required: false
  }));

  app.save(collection_Timelines_restore_editList);

  const collection_Timelines_revert_version = app.findCollectionByNameOrId("Timelines");
  const collection_Timelines_revert_version_field = collection_Timelines_revert_version.fields.getByName("version");

  collection_Timelines_revert_version_field.min = null;

  app.save(collection_Timelines_revert_version);

  const collection_Timelines_revert_add_timelineData = app.findCollectionByNameOrId("Timelines");

  collection_Timelines_revert_add_timelineData.fields.removeByName("timelineData");

  return app.save(collection_Timelines_revert_add_timelineData);
});
