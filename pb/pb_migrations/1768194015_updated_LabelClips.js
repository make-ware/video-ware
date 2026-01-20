/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pb_xvvovw30u1i3ew4")

  // add field
  collection.fields.addAt(17, new Field({
    "cascadeDelete": false,
    "collectionId": "pb_mo92djgubjkikt4",
    "hidden": false,
    "id": "relation3894241008",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "LabelEntityRef",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pb_xvvovw30u1i3ew4")

  // remove field
  collection.fields.removeById("relation3894241008")

  return app.save(collection)
})
