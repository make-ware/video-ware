/// <reference path="../pb_data/types.d.ts" />

// Timeline state is the Timelines/TimelineTracks/TimelineClips collections;
// the flattened track snapshot lives only on TimelineRenders (frozen per
// render). The Timelines.timelineData copy was write-only — drop it.
migrate((app) => {
  const collection_Timelines_remove_timelineData = app.findCollectionByNameOrId("Timelines");

  collection_Timelines_remove_timelineData.fields.removeByName("timelineData");

  return app.save(collection_Timelines_remove_timelineData);
}, (app) => {
  const collection_Timelines_restore_timelineData = app.findCollectionByNameOrId("Timelines");

  collection_Timelines_restore_timelineData.fields.add(new JSONField({
    name: "timelineData",
    required: false
  }));

  return app.save(collection_Timelines_restore_timelineData);
});
