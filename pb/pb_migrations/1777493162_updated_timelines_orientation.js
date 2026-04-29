/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_Timelines_add_orientation = app.findCollectionByNameOrId("Timelines");

  collection_Timelines_add_orientation.fields.add(new SelectField({
    name: "orientation",
    required: false,
    maxSelect: 1,
    values: ["landscape", "portrait"]
  }));

  return app.save(collection_Timelines_add_orientation);
}, (app) => {
  const collection_Timelines_remove_orientation = app.findCollectionByNameOrId("Timelines");

  collection_Timelines_remove_orientation.fields.removeByName("orientation");

  return app.save(collection_Timelines_remove_orientation);
});
