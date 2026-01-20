/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pb_91w0ka5joz10lay")

  // update field
  collection.fields.addAt(6, new Field({
    "cascadeDelete": false,
    "collectionId": "pb_fb18j6mto8zli16",
    "hidden": false,
    "id": "relation1437481087",
    "maxSelect": 999,
    "minSelect": 0,
    "name": "TimelineClipsRef",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pb_91w0ka5joz10lay")

  // update field
  collection.fields.addAt(6, new Field({
    "cascadeDelete": false,
    "collectionId": "pb_fb18j6mto8zli16",
    "hidden": false,
    "id": "relation1437481087",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "TimelineClipRef",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  return app.save(collection)
})
