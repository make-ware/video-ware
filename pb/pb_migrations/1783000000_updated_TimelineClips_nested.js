/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pb_fb18j6mto8zli16"); // TimelineClips

  // Nested-timeline clips reference another Timeline instead of Media/Caption.
  // cascadeDelete stays false to match the MediaRef/CaptionRef policy: a
  // timeline is the user's edit and must survive deletion of its sources —
  // PocketBase clears the dangling ref and the UI shows a missing-source clip.
  collection.fields.add(new RelationField({
    name: "SourceTimelineRef",
    required: false,
    collectionId: "pb_8la546it5zge3cv", // Timelines
    maxSelect: 1,
    minSelect: 0,
    cascadeDelete: false,
  }));

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pb_fb18j6mto8zli16"); // TimelineClips

  collection.fields.removeByName("SourceTimelineRef");

  return app.save(collection);
});
