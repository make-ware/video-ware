/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_Media_add_mediaDate_0 = app.findCollectionByNameOrId("Media");

  collection_Media_add_mediaDate_0.fields.add(new DateField({
    name: "mediaDate",
    required: false
  }));

  app.save(collection_Media_add_mediaDate_0);

  const collection_Media_add_width_1 = app.findCollectionByNameOrId("Media");

  collection_Media_add_width_1.fields.add(new NumberField({
    name: "width",
    required: false
  }));

  app.save(collection_Media_add_width_1);

  const collection_Media_add_height_2 = app.findCollectionByNameOrId("Media");

  collection_Media_add_height_2.fields.add(new NumberField({
    name: "height",
    required: false
  }));

  app.save(collection_Media_add_height_2);

  const collection_Media_add_aspectRatio_3 = app.findCollectionByNameOrId("Media");

  collection_Media_add_aspectRatio_3.fields.add(new NumberField({
    name: "aspectRatio",
    required: false
  }));

  return app.save(collection_Media_add_aspectRatio_3);
  
}, (app) => {
  const collection_Media_revert_add_width = app.findCollectionByNameOrId("Media");

  collection_Media_revert_add_width.fields.removeByName("width");

  app.save(collection_Media_revert_add_width);

  const collection_Media_revert_add_height = app.findCollectionByNameOrId("Media");

  collection_Media_revert_add_height.fields.removeByName("height");

  app.save(collection_Media_revert_add_height);

  const collection_Media_revert_add_aspectRatio = app.findCollectionByNameOrId("Media");

  collection_Media_revert_add_aspectRatio.fields.removeByName("aspectRatio");

  return app.save(collection_Media_revert_add_aspectRatio);
});
