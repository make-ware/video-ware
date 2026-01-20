/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pb_1q5cu7dybj36pxm")

  // add field
  collection.fields.addAt(17, new Field({
    "cascadeDelete": false,
    "collectionId": "pb_48ql3az7t9ok2mu",
    "hidden": false,
    "id": "relation2484009742",
    "maxSelect": 999,
    "minSelect": 0,
    "name": "filmstripFileRefs",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pb_1q5cu7dybj36pxm")

  // remove field
  collection.fields.removeById("relation2484009742")

  return app.save(collection)
})
