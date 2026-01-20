/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pb_xvvovw30u1i3ew4")

  // add field
  collection.fields.addAt(18, new Field({
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
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pb_xvvovw30u1i3ew4")

  // remove field
  collection.fields.removeById("relation2523979975")

  return app.save(collection)
})
