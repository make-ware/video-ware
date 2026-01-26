/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_Media_add_isActive_0 = app.findCollectionByNameOrId("pb_1q5cu7dybj36pxm") // Media;

  collection_Media_add_isActive_0.fields.add(new BoolField({
    name: "isActive",
    required: false
  }));

  return app.save(collection_Media_add_isActive_0);
}, (app) => {
  const collection_Media_revert_add_isActive = app.findCollectionByNameOrId("pb_1q5cu7dybj36pxm") // Media;

  collection_Media_revert_add_isActive.fields.removeByName("isActive");

  return app.save(collection_Media_revert_add_isActive);
});
