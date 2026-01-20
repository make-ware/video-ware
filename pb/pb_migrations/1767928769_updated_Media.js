/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pb_1q5cu7dybj36pxm")

  // add field
  collection.fields.addAt(13, new Field({
    "hidden": false,
    "id": "date211219267",
    "max": "",
    "min": "",
    "name": "mediaDate",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pb_1q5cu7dybj36pxm")

  // remove field
  collection.fields.removeById("date211219267")

  return app.save(collection)
})
