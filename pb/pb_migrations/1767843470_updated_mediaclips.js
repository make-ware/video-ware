/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_MediaClips_add_version_0 = app.findCollectionByNameOrId("MediaClips");

  collection_MediaClips_add_version_0.fields.add(new NumberField({
    name: "version",
    required: false
  }));

  app.save(collection_MediaClips_add_version_0);

  const collection_MediaClips_add_processor_1 = app.findCollectionByNameOrId("MediaClips");

  collection_MediaClips_add_processor_1.fields.add(new TextField({
    name: "processor",
    required: false
  }));

  return app.save(collection_MediaClips_add_processor_1);
}, (app) => {
  const collection_MediaClips_revert_add_version = app.findCollectionByNameOrId("MediaClips");

  collection_MediaClips_revert_add_version.fields.removeByName("version");

  app.save(collection_MediaClips_revert_add_version);

  const collection_MediaClips_revert_add_processor = app.findCollectionByNameOrId("MediaClips");

  collection_MediaClips_revert_add_processor.fields.removeByName("processor");

  return app.save(collection_MediaClips_revert_add_processor);
});
