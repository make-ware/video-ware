/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_Files_modify_fileType = app.findCollectionByNameOrId("Files");
  const collection_Files_modify_fileType_field = collection_Files_modify_fileType.fields.getByName("fileType");

  collection_Files_modify_fileType_field.values = ["original", "proxy", "audio", "thumbnail", "sprite", "labels_json", "render", "filmstrip"];

  return app.save(collection_Files_modify_fileType);
}, (app) => {
  const collection_Files_revert_fileType = app.findCollectionByNameOrId("Files");
  const collection_Files_revert_fileType_field = collection_Files_revert_fileType.fields.getByName("fileType");

  collection_Files_revert_fileType_field.values = ["original", "proxy", "thumbnail", "sprite", "labels_json", "render"];

  return app.save(collection_Files_revert_fileType);
});
