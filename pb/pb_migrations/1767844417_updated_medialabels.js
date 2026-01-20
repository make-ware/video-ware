/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_MediaLabels_add_processor_0 = app.findCollectionByNameOrId("MediaLabels");

  collection_MediaLabels_add_processor_0.fields.add(new TextField({
    name: "processor",
    required: true
  }));

  return app.save(collection_MediaLabels_add_processor_0);
}, (app) => {
  const collection_MediaLabels_revert_add_processor = app.findCollectionByNameOrId("MediaLabels");

  collection_MediaLabels_revert_add_processor.fields.removeByName("processor");

  return app.save(collection_MediaLabels_revert_add_processor);
});
