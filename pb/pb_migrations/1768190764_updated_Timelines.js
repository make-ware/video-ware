/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pb_8la546it5zge3cv")

  // update field
  collection.fields.addAt(7, new Field({
    "hidden": false,
    "id": "json1690798567",
    "maxSize": 0,
    "name": "timelineData",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pb_8la546it5zge3cv")

  // update field
  collection.fields.addAt(7, new Field({
    "hidden": false,
    "id": "json1690798567",
    "maxSize": 0,
    "name": "editList",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
})
