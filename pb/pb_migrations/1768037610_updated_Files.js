/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pb_48ql3az7t9ok2mu")

  // update field
  collection.fields.addAt(6, new Field({
    "hidden": false,
    "id": "select1321496436",
    "maxSelect": 1,
    "name": "fileType",
    "presentable": false,
    "required": true,
    "system": false,
    "type": "select",
    "values": [
      "original",
      "proxy",
      "thumbnail",
      "sprite",
      "labels_json",
      "render",
      "filmstrip"
    ]
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pb_48ql3az7t9ok2mu")

  // update field
  collection.fields.addAt(6, new Field({
    "hidden": false,
    "id": "select1321496436",
    "maxSelect": 1,
    "name": "fileType",
    "presentable": false,
    "required": true,
    "system": false,
    "type": "select",
    "values": [
      "original",
      "proxy",
      "thumbnail",
      "sprite",
      "labels_json",
      "render"
    ]
  }))

  return app.save(collection)
})
