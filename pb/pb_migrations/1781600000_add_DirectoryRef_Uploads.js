/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // Add DirectoryRef to Uploads so the target directory travels with the upload
  // record. A PocketBase hook (and the worker) can then place the resulting
  // Media in the right directory without an out-of-band header.
  const uploadsCollection = app.findCollectionByNameOrId("Uploads");
  uploadsCollection.fields.add(new Field({
    "name": "DirectoryRef",
    "id": "rel_upload_directory",
    "type": "relation",
    "required": false,
    "collectionId": "pb_directories0001",
    "maxSelect": 1,
    "minSelect": 0,
    "cascadeDelete": false,
    "displayFields": null,
  }));

  return app.save(uploadsCollection);
}, (app) => {
  const uploadsCollection = app.findCollectionByNameOrId("Uploads");
  uploadsCollection.fields.removeById("rel_upload_directory");
  return app.save(uploadsCollection);
});
