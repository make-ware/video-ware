/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pb_rufl1k4pwg3zofz")

  // update collection data
  unmarshal({
    "indexes": []
  }, collection)

  // remove field
  collection.fields.removeById("text1636234320")

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pb_rufl1k4pwg3zofz")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE INDEX idx_label_face_track ON LabelFace (trackId)"
    ]
  }, collection)

  // add field
  collection.fields.addAt(6, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1636234320",
    "max": 0,
    "min": 1,
    "name": "trackId",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": true,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
})
