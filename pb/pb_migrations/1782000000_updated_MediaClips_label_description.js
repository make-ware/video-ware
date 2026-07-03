/// <reference path="../pb_data/types.d.ts" />
// Editor-facing label + description on MediaClips: optional plain-text fields
// editors can set to name/annotate a clip and make it searchable.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pb_v0io398cfx6qzc3"); // MediaClips

  collection.fields.add(new TextField({
    name: "label",
    required: false,
  }));

  collection.fields.add(new TextField({
    name: "description",
    required: false,
  }));

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pb_v0io398cfx6qzc3"); // MediaClips

  collection.fields.removeByName("label");
  collection.fields.removeByName("description");

  return app.save(collection);
});
