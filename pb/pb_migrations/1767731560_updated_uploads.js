/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_Uploads_add_storageBackend_0 = app.findCollectionByNameOrId("Uploads");

  collection_Uploads_add_storageBackend_0.fields.add(new SelectField({
    name: "storageBackend",
    required: false,
    maxSelect: 1,
    values: ["local", "s3"]
  }));

  app.save(collection_Uploads_add_storageBackend_0);

  const collection_Uploads_add_externalPath_1 = app.findCollectionByNameOrId("Uploads");

  collection_Uploads_add_externalPath_1.fields.add(new TextField({
    name: "externalPath",
    required: false
  }));

  app.save(collection_Uploads_add_externalPath_1);

  const collection_Uploads_add_storageConfig_2 = app.findCollectionByNameOrId("Uploads");

  collection_Uploads_add_storageConfig_2.fields.add(new JSONField({
    name: "storageConfig",
    required: false
  }));

  app.save(collection_Uploads_add_storageConfig_2);

  const collection_Uploads_add_bytesUploaded_3 = app.findCollectionByNameOrId("Uploads");

  collection_Uploads_add_bytesUploaded_3.fields.add(new NumberField({
    name: "bytesUploaded",
    required: false
  }));

  app.save(collection_Uploads_add_bytesUploaded_3);

  const collection_Uploads_modify_UserRef = app.findCollectionByNameOrId("Uploads");
  const collection_Uploads_modify_UserRef_field = collection_Uploads_modify_UserRef.fields.getByName("UserRef");

  collection_Uploads_modify_UserRef_field.required = true;

  app.save(collection_Uploads_modify_UserRef);

  const collection_Uploads_remove_originalFile = app.findCollectionByNameOrId("Uploads");

  collection_Uploads_remove_originalFile.fields.removeByName("originalFile");

  return app.save(collection_Uploads_remove_originalFile);
}, (app) => {
  const collection_Uploads_restore_originalFile = app.findCollectionByNameOrId("Uploads");

  collection_Uploads_restore_originalFile.fields.add(new FileField({
    name: "originalFile",
    required: false,
    maxSize: 7000000000
  }));

  app.save(collection_Uploads_restore_originalFile);

  const collection_Uploads_revert_UserRef = app.findCollectionByNameOrId("Uploads");
  const collection_Uploads_revert_UserRef_field = collection_Uploads_revert_UserRef.fields.getByName("UserRef");

  collection_Uploads_revert_UserRef_field.required = false;

  app.save(collection_Uploads_revert_UserRef);

  const collection_Uploads_revert_add_storageBackend = app.findCollectionByNameOrId("Uploads");

  collection_Uploads_revert_add_storageBackend.fields.removeByName("storageBackend");

  app.save(collection_Uploads_revert_add_storageBackend);

  const collection_Uploads_revert_add_externalPath = app.findCollectionByNameOrId("Uploads");

  collection_Uploads_revert_add_externalPath.fields.removeByName("externalPath");

  app.save(collection_Uploads_revert_add_externalPath);

  const collection_Uploads_revert_add_storageConfig = app.findCollectionByNameOrId("Uploads");

  collection_Uploads_revert_add_storageConfig.fields.removeByName("storageConfig");

  app.save(collection_Uploads_revert_add_storageConfig);

  const collection_Uploads_revert_add_bytesUploaded = app.findCollectionByNameOrId("Uploads");

  collection_Uploads_revert_add_bytesUploaded.fields.removeByName("bytesUploaded");

  return app.save(collection_Uploads_revert_add_bytesUploaded);
});
