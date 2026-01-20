/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pb_xvvovw30u1i3ew4")

  // update field
  collection.fields.addAt(6, new Field({
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
  const collection = app.findCollectionByNameOrId("pb_xvvovw30u1i3ew4")

  // update field
  collection.fields.addAt(6, new Field({
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
