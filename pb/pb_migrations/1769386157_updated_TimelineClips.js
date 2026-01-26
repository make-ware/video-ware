/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_TimelineClips_add_TimelineTrackRef_0 = app.findCollectionByNameOrId("pb_fb18j6mto8zli16") // TimelineClips;

  collection_TimelineClips_add_TimelineTrackRef_0.fields.add(new RelationField({
    name: "TimelineTrackRef",
    required: false,
    collectionId: "pb_4j2ljpjxrs0nwcq",
    maxSelect: 1,
    minSelect: 0,
    cascadeDelete: false
  }));

  app.save(collection_TimelineClips_add_TimelineTrackRef_0);

  const collection_TimelineClips_add_timelineStart_1 = app.findCollectionByNameOrId("pb_fb18j6mto8zli16") // TimelineClips;

  collection_TimelineClips_add_timelineStart_1.fields.add(new NumberField({
    name: "timelineStart",
    required: false,
    min: 0
  }));

  return app.save(collection_TimelineClips_add_timelineStart_1);
}, (app) => {
  const collection_TimelineClips_revert_add_TimelineTrackRef = app.findCollectionByNameOrId("pb_fb18j6mto8zli16") // TimelineClips;

  collection_TimelineClips_revert_add_TimelineTrackRef.fields.removeByName("TimelineTrackRef");

  app.save(collection_TimelineClips_revert_add_TimelineTrackRef);

  const collection_TimelineClips_revert_add_timelineStart = app.findCollectionByNameOrId("pb_fb18j6mto8zli16") // TimelineClips;

  collection_TimelineClips_revert_add_timelineStart.fields.removeByName("timelineStart");

  return app.save(collection_TimelineClips_revert_add_timelineStart);
});
