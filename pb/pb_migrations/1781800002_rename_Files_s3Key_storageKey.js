/// <reference path="../pb_data/types.d.ts" />
// Rename Files.s3Key -> Files.storageKey. The field is populated for every file
// source (s3, gcs, pocketbase, local-backend key), so "s3Key" was misleading.
// Renaming by field name keeps the field's internal id stable, so existing data
// is preserved (this is a column rename, not a drop/recreate).
migrate((app) => {
  const collection = app.findCollectionByNameOrId("Files");
  const field = collection.fields.getByName("s3Key");
  if (field) {
    field.name = "storageKey";
    app.save(collection);
  }
}, (app) => {
  const collection = app.findCollectionByNameOrId("Files");
  const field = collection.fields.getByName("storageKey");
  if (field) {
    field.name = "s3Key";
    app.save(collection);
  }
});
