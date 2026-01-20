/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pb_xvvovw30u1i3ew4");

  return app.delete(collection);
  // const collection_LabelMedia = app.findCollectionByNameOrId("LabelClips");
  // return app.delete(collection_LabelMedia);
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
        "cascadeDelete": false,
        "collectionId": "pb_rm2tsf1ujhh49zr",
        "hidden": false,
        "id": "relation141067625",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "TaskRef",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
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
          "speech",
          "face",
          "segment",
          "text"
        ]
      },
      {
        "autogeneratePattern": "",
        "hidden": false,
        "id": "text2363381545",
        "max": 0,
        "min": 0,
        "name": "type",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
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
        "hidden": false,
        "id": "number2254405824",
        "max": null,
        "min": 0,
        "name": "duration",
        "onlyInt": false,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "number"
      },
      {
        "hidden": false,
        "id": "number158830993",
        "max": 1,
        "min": 0,
        "name": "confidence",
        "onlyInt": false,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "number"
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
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "select2462348188",
        "maxSelect": 1,
        "name": "provider",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "select",
        "values": [
          "google_video_intelligence",
          "google_speech"
        ]
      },
      {
        "hidden": false,
        "id": "json1950882835",
        "maxSize": 0,
        "name": "labelData",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "json"
      },
      {
        "autogeneratePattern": "",
        "hidden": false,
        "id": "text134450632",
        "max": 0,
        "min": 1,
        "name": "labelHash",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "cascadeDelete": false,
        "collectionId": "pb_mo92djgubjkikt4",
        "hidden": false,
        "id": "relation3894241008",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "LabelEntityRef",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      },
      {
        "cascadeDelete": false,
        "collectionId": "pb_03xhgjzhymxc1pg",
        "hidden": false,
        "id": "relation2523979975",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "LabelTrackRef",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      }
    ],
    "id": "pb_xvvovw30u1i3ew4",
    "indexes": [
      "CREATE UNIQUE INDEX `idx_epsB2CdEW3` ON `LabelClips` (`labelHash`)"
    ],
    "listRule": "@request.auth.id != \"\"",
    "name": "LabelClips",
    "system": false,
    "type": "base",
    "updateRule": "@request.auth.id != \"\"",
    "viewRule": "@request.auth.id != \"\""
  });

  return app.save(collection);
})
