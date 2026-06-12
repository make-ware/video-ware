/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pb_fb18j6mto8zli16"); // TimelineClips

  // Caption clips reference a Caption instead of Media
  collection.fields.add(new RelationField({
    name: "CaptionRef",
    required: false,
    collectionId: "pb_cap5q8r2w7n4x1k", // Captions
    maxSelect: 1,
    minSelect: 0,
    cascadeDelete: false,
  }));

  const mediaRef = collection.fields.getByName("MediaRef");
  mediaRef.required = false;

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pb_fb18j6mto8zli16"); // TimelineClips

  collection.fields.removeByName("CaptionRef");

  const mediaRef = collection.fields.getByName("MediaRef");
  mediaRef.required = true;

  return app.save(collection);
});
