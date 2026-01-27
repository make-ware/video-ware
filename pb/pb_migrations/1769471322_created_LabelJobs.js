/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    "id": "pb_64xagwh9qro4ta9",
    "name": "LabelJobs",
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
      "name": "MediaRef",
      "id": "text8g7gqetkjq",
      "type": "relation",
      "required": true,
      "collectionId": "pb_1q5cu7dybj36pxm",
      "maxSelect": 1,
      "minSelect": 0,
      "cascadeDelete": false,
      "displayFields": null,
    },
    {
      "name": "jobType",
      "id": "textx033trkgde",
      "type": "text",
      "required": true,
    },
    {
      "name": "TaskRef",
      "id": "textkc8tdkj1w8",
      "type": "relation",
      "required": false,
      "collectionId": "pb_rm2tsf1ujhh49zr",
      "maxSelect": 1,
      "minSelect": 0,
      "cascadeDelete": false,
      "displayFields": null,
    },
    {
      "name": "version",
      "id": "numberuu1zmyp054",
      "type": "number",
      "required": false,
    },
  ],
    "indexes": [],
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pb_64xagwh9qro4ta9") // LabelJobs;
  return app.delete(collection);
});
