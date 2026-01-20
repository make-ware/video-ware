/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_Media_add_processor_3 = app.findCollectionByNameOrId("Media");

  collection_Media_add_processor_3.fields.add(new TextField({
    name: "processor",
    required: false
  }));

  return app.save(collection_Media_add_processor_3);
}, (app) => {
  const collection_Media_revert_add_processor = app.findCollectionByNameOrId("Media");

  collection_Media_revert_add_processor.fields.removeByName("processor");

  return app.save(collection_Media_revert_add_processor);
});
