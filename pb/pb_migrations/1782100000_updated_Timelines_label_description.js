/// <reference path="../pb_data/types.d.ts" />
// Editor-facing label + description on Timelines, TimelineTracks, and
// TimelineClips: optional plain-text fields editors can set to name/annotate a
// timeline, track, or clip (clip values override the source clip) and make them
// searchable.
migrate((app) => {
  const collection_Timelines_add_label_description = app.findCollectionByNameOrId("pb_8la546it5zge3cv"); // Timelines

  collection_Timelines_add_label_description.fields.add(new TextField({
    name: "label",
    required: false,
  }));

  collection_Timelines_add_label_description.fields.add(new TextField({
    name: "description",
    required: false,
  }));

  app.save(collection_Timelines_add_label_description);

  const collection_TimelineTracks_add_label_description = app.findCollectionByNameOrId("pb_4j2ljpjxrs0nwcq"); // TimelineTracks

  collection_TimelineTracks_add_label_description.fields.add(new TextField({
    name: "label",
    required: false,
  }));

  collection_TimelineTracks_add_label_description.fields.add(new TextField({
    name: "description",
    required: false,
  }));

  app.save(collection_TimelineTracks_add_label_description);

  const collection_TimelineClips_add_label_description = app.findCollectionByNameOrId("pb_fb18j6mto8zli16"); // TimelineClips

  collection_TimelineClips_add_label_description.fields.add(new TextField({
    name: "label",
    required: false,
  }));

  collection_TimelineClips_add_label_description.fields.add(new TextField({
    name: "description",
    required: false,
  }));

  return app.save(collection_TimelineClips_add_label_description);
}, (app) => {
  const collection_Timelines_remove_label_description = app.findCollectionByNameOrId("pb_8la546it5zge3cv"); // Timelines

  collection_Timelines_remove_label_description.fields.removeByName("label");
  collection_Timelines_remove_label_description.fields.removeByName("description");

  app.save(collection_Timelines_remove_label_description);

  const collection_TimelineTracks_remove_label_description = app.findCollectionByNameOrId("pb_4j2ljpjxrs0nwcq"); // TimelineTracks

  collection_TimelineTracks_remove_label_description.fields.removeByName("label");
  collection_TimelineTracks_remove_label_description.fields.removeByName("description");

  app.save(collection_TimelineTracks_remove_label_description);

  const collection_TimelineClips_remove_label_description = app.findCollectionByNameOrId("pb_fb18j6mto8zli16"); // TimelineClips

  collection_TimelineClips_remove_label_description.fields.removeByName("label");
  collection_TimelineClips_remove_label_description.fields.removeByName("description");

  return app.save(collection_TimelineClips_remove_label_description);
});
