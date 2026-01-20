/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pb_85qd7k3nik12v7r")

  // update field
  collection.fields.addAt(5, new Field({
    "cascadeDelete": false,
    "collectionId": "pb_v0io398cfx6qzc3",
    "hidden": false,
    "id": "relation3871133167",
    "maxSelect": 999,
    "minSelect": 0,
    "name": "MediaClipsRef",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pb_85qd7k3nik12v7r")

  // update field
  collection.fields.addAt(5, new Field({
    "cascadeDelete": false,
    "collectionId": "pb_v0io398cfx6qzc3",
    "hidden": false,
    "id": "relation3871133167",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "MediaClipRef",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  return app.save(collection)
})
