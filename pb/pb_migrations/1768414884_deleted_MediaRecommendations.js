/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pb_1woxwta38s45v6j");

  return app.delete(collection);
  // const collection_MediaRecommendations = app.findCollectionByNameOrId("MediaRecommendations");
  // return app.delete(collection_MediaRecommendations);
}, (app) => {
  const collection = new Collection({
    "createRule": "@request.auth.id != \"\"",
    "deleteRule": "@request.auth.id != \"\"",
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "hidden": false,
        "id": "text3208210256",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "autodate2990389176",
        "name": "created",
        "onCreate": true,
        "onUpdate": false,
        "presentable": false,
        "system": false,
        "type": "autodate"
      },
      {
        "hidden": false,
        "id": "autodate3332085495",
        "name": "updated",
        "onCreate": true,
        "onUpdate": true,
        "presentable": false,
        "system": false,
        "type": "autodate"
      },
      {
        "cascadeDelete": false,
        "collectionId": "pb_6znl9bq7apv0rcg",
        "hidden": false,
        "id": "relation3498470548",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "WorkspaceRef",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "relation"
      },
      {
        "cascadeDelete": false,
        "collectionId": "pb_1q5cu7dybj36pxm",
        "hidden": false,
        "id": "relation1502216784",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "MediaRef",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "relation"
      },
      {
        "hidden": false,
        "id": "number2675529103",
        "max": null,
        "min": 0,
        "name": "start",
        "onlyInt": false,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "number"
      },
      {
        "hidden": false,
        "id": "number16528305",
        "max": null,
        "min": 0,
        "name": "end",
        "onlyInt": false,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "number"
      },
      {
        "cascadeDelete": false,
        "collectionId": "pb_v0io398cfx6qzc3",
        "hidden": false,
        "id": "relation3871133167",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "MediaClipRef",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      },
      {
        "hidden": false,
        "id": "number848901969",
        "max": 1,
        "min": 0,
        "name": "score",
        "onlyInt": false,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "number"
      },
      {
        "hidden": false,
        "id": "number2289690853",
        "max": null,
        "min": 0,
        "name": "rank",
        "onlyInt": false,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "number"
      },
      {
        "autogeneratePattern": "",
        "hidden": false,
        "id": "text1001949196",
        "max": 500,
        "min": 1,
        "name": "reason",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "json891708489",
        "maxSize": 0,
        "name": "reasonData",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "json"
      },
      {
        "hidden": false,
        "id": "select340149741",
        "maxSelect": 1,
        "name": "strategy",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "select",
        "values": [
          "same_entity",
          "adjacent_shot",
          "temporal_nearby",
          "confidence_duration"
        ]
      },
      {
        "hidden": false,
        "id": "select1432729689",
        "maxSelect": 1,
        "name": "labelType",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "select",
        "values": [
          "object",
          "shot",
          "person",
          "face",
          "speech",
          "segment",
          "text"
        ]
      },
      {
        "autogeneratePattern": "",
        "hidden": false,
        "id": "text3725132640",
        "max": 0,
        "min": 1,
        "name": "queryHash",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "number3206337475",
        "max": null,
        "min": null,
        "name": "version",
        "onlyInt": false,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "number"
      },
      {
        "autogeneratePattern": "",
        "hidden": false,
        "id": "text700466768",
        "max": 0,
        "min": 0,
        "name": "processor",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      }
    ],
    "id": "pb_1woxwta38s45v6j",
    "indexes": [
      "CREATE UNIQUE INDEX idx_media_rec_hash_segment ON MediaRecommendations (queryHash, start, end)",
      "CREATE INDEX idx_media_rec_context ON MediaRecommendations (WorkspaceRef, MediaRef, queryHash)",
      "CREATE INDEX idx_media_rec_rank ON MediaRecommendations (queryHash, rank)",
      "CREATE INDEX idx_media_rec_label_type ON MediaRecommendations (MediaRef, labelType)"
    ],
    "listRule": "@request.auth.id != \"\"",
    "name": "MediaRecommendations",
    "system": false,
    "type": "base",
    "updateRule": "@request.auth.id != \"\"",
    "viewRule": "@request.auth.id != \"\""
  });

  return app.save(collection);
})
