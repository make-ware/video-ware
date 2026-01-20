/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pb_hfau4b1bi8yfufa");

  return app.delete(collection);
  // const collection_TimelineRecommendations = app.findCollectionByNameOrId("TimelineRecommendations");
  // return app.delete(collection_TimelineRecommendations);
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
        "collectionId": "pb_8la546it5zge3cv",
        "hidden": false,
        "id": "relation557969299",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "TimelineRef",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "relation"
      },
      {
        "cascadeDelete": false,
        "collectionId": "pb_fb18j6mto8zli16",
        "hidden": false,
        "id": "relation1437481087",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "TimelineClipRef",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      },
      {
        "cascadeDelete": false,
        "collectionId": "pb_fb18j6mto8zli16",
        "hidden": false,
        "id": "relation3656063843",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "SeedClipRef",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
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
        "required": true,
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
        "id": "select3045315482",
        "maxSelect": 1,
        "name": "targetMode",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "select",
        "values": [
          "append",
          "replace"
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
        "id": "date3321338401",
        "max": "",
        "min": "",
        "name": "acceptedAt",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "date"
      },
      {
        "hidden": false,
        "id": "date4101927548",
        "max": "",
        "min": "",
        "name": "dismissedAt",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "date"
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
    "id": "pb_hfau4b1bi8yfufa",
    "indexes": [
      "CREATE UNIQUE INDEX idx_timeline_rec_hash_clip ON TimelineRecommendations (queryHash, MediaClipRef)",
      "CREATE INDEX idx_timeline_rec_context ON TimelineRecommendations (WorkspaceRef, TimelineRef, queryHash)",
      "CREATE INDEX idx_timeline_rec_rank ON TimelineRecommendations (queryHash, rank)",
      "CREATE INDEX idx_timeline_rec_feedback ON TimelineRecommendations (strategy, acceptedAt, dismissedAt)"
    ],
    "listRule": "@request.auth.id != \"\"",
    "name": "TimelineRecommendations",
    "system": false,
    "type": "base",
    "updateRule": "@request.auth.id != \"\"",
    "viewRule": "@request.auth.id != \"\""
  });

  return app.save(collection);
})
