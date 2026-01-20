/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_Timelines_add_processor_1 = app.findCollectionByNameOrId("Timelines");
  collection_Timelines_add_processor_1.fields.add(new TextField({
    name: "processor",
    required: false
  }));

  app.save(collection_Timelines_add_processor_1);

  const collection_Timelines_modify_version = app.findCollectionByNameOrId("Timelines");
  const collection_Timelines_modify_version_field = collection_Timelines_modify_version.fields.getByName("version");

  collection_Timelines_modify_version_field.min = null;

  return app.save(collection_Timelines_modify_version);
}, (app) => {
  const collection_Timelines_revert_version = app.findCollectionByNameOrId("Timelines");
  const collection_Timelines_revert_version_field = collection_Timelines_revert_version.fields.getByName("version");

  collection_Timelines_revert_version_field.min = 1;

  app.save(collection_Timelines_revert_version);

  const collection_Timelines_revert_add_UserRef = app.findCollectionByNameOrId("Timelines");

  collection_Timelines_revert_add_UserRef.fields.removeByName("UserRef");

  return app.save(collection_Timelines_revert_add_UserRef);
});
