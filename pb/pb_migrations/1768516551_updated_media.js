/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_Media_add_hasAudio_0 = app.findCollectionByNameOrId("Media");

  collection_Media_add_hasAudio_0.fields.add(new BoolField({
    name: "hasAudio",
    required: false
  }));

  return app.save(collection_Media_add_hasAudio_0);
}, (app) => {
  const collection_Media_revert_add_hasAudio = app.findCollectionByNameOrId("Media");

  collection_Media_revert_add_hasAudio.fields.removeByName("hasAudio");

  return app.save(collection_Media_revert_add_hasAudio);
});
