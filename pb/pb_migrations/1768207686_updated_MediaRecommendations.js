/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pb_1woxwta38s45v6j")

  // update field
  collection.fields.addAt(13, new Field({
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
      "face"
    ]
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pb_1woxwta38s45v6j")

  // update field
  collection.fields.addAt(13, new Field({
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
      "speech"
    ]
  }))

  return app.save(collection)
})
