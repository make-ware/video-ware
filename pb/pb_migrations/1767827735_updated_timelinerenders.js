/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_TimelineRenders_add_version_0 = app.findCollectionByNameOrId("TimelineRenders");

  collection_TimelineRenders_add_version_0.fields.add(new NumberField({
    name: "version",
    required: false
  }));

  app.save(collection_TimelineRenders_add_version_0);

  const collection_TimelineRenders_remove_timelineVersion = app.findCollectionByNameOrId("TimelineRenders");

  collection_TimelineRenders_remove_timelineVersion.fields.removeByName("timelineVersion");

  return app.save(collection_TimelineRenders_remove_timelineVersion);
}, (app) => {
  const collection_TimelineRenders_restore_timelineVersion = app.findCollectionByNameOrId("TimelineRenders");

  collection_TimelineRenders_restore_timelineVersion.fields.add(new NumberField({
    name: "timelineVersion",
    required: false,
    min: 1
  }));

  app.save(collection_TimelineRenders_restore_timelineVersion);

  const collection_TimelineRenders_revert_add_version = app.findCollectionByNameOrId("TimelineRenders");

  collection_TimelineRenders_revert_add_version.fields.removeByName("version");

  return app.save(collection_TimelineRenders_revert_add_version);
});
