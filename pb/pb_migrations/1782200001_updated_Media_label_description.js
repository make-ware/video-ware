/// <reference path="../pb_data/types.d.ts" />
// Editor-facing label + description on Media: optional plain-text fields
// editors can set to name/annotate a media item and make it searchable.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("Media");

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
  const collection = app.findCollectionByNameOrId("Media");

  collection.fields.removeByName("label");
  collection.fields.removeByName("description");

  return app.save(collection);
});
