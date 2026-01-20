/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pb_03xhgjzhymxc1pg")

  // update field
  collection.fields.addAt(13, new Field({
    "hidden": false,
    "id": "json2523404393",
    "maxSize": 0,
    "name": "keyframes",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pb_03xhgjzhymxc1pg")

  // update field
  collection.fields.addAt(13, new Field({
    "hidden": false,
    "id": "json2523404393",
    "maxSize": 0,
    "name": "keyframes",
    "presentable": false,
    "required": true,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
})
