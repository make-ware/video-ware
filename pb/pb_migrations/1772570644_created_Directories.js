/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // 1. Create the Directories collection
  const collection = new Collection({
    "id": "pb_directories0001",
    "name": "Directories",
    "type": "base",
    "system": false,
    "listRule": "@request.auth.id != \"\"",
    "viewRule": "@request.auth.id != \"\"",
    "createRule": "@request.auth.id != \"\"",
    "updateRule": "@request.auth.id != \"\"",
    "deleteRule": "@request.auth.id != \"\"",
    "fields": [
      {
        "name": "id",
        "id": "text3208210256",
        "type": "text",
        "required": true,
        "autogeneratePattern": "[a-z0-9]{15}",
        "hidden": false,
        "max": 15,
        "min": 15,
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "system": true,
      },
      {
        "name": "WorkspaceRef",
        "id": "rel_dir_workspace",
        "type": "relation",
        "required": true,
        "collectionId": "pb_workspaces001",
        "maxSelect": 1,
        "minSelect": 0,
        "cascadeDelete": false,
        "displayFields": null,
      },
      {
        "name": "ParentDirectoryRef",
        "id": "rel_dir_parent",
        "type": "relation",
        "required": false,
        "collectionId": "pb_directories0001",
        "maxSelect": 1,
        "minSelect": 0,
        "cascadeDelete": false,
        "displayFields": null,
      },
      {
        "name": "name",
        "id": "text_dir_name",
        "type": "text",
        "required": true,
      },
    ],
    "indexes": [],
  });

  app.save(collection);

  // 2. Add DirectoryRef field to the existing Media collection
  const mediaCollection = app.findCollectionByNameOrId("Media");
  mediaCollection.fields.add(new Field({
    "name": "DirectoryRef",
    "id": "rel_media_directory",
    "type": "relation",
    "required": false,
    "collectionId": "pb_directories0001",
    "maxSelect": 1,
    "minSelect": 0,
    "cascadeDelete": false,
    "displayFields": null,
  }));

  return app.save(mediaCollection);
}, (app) => {
  // Revert: remove DirectoryRef from Media
  const mediaCollection = app.findCollectionByNameOrId("Media");
  mediaCollection.fields.removeById("rel_media_directory");
  app.save(mediaCollection);

  // Revert: delete Directories collection
  const collection = app.findCollectionByNameOrId("pb_directories0001");
  return app.delete(collection);
});
