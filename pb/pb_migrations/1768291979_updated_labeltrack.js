/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_LabelTrack_add_boundingBox_0 = app.findCollectionByNameOrId("LabelTrack");

  collection_LabelTrack_add_boundingBox_0.fields.add(new JSONField({
    name: "boundingBox",
    required: false
  }));

  app.save(collection_LabelTrack_add_boundingBox_0);

  const collection_LabelTrack_modify_LabelEntityRef = app.findCollectionByNameOrId("LabelTrack");
  const collection_LabelTrack_modify_LabelEntityRef_field = collection_LabelTrack_modify_LabelEntityRef.fields.getByName("LabelEntityRef");

  collection_LabelTrack_modify_LabelEntityRef_field.required = false;

  app.save(collection_LabelTrack_modify_LabelEntityRef);

  const collection_LabelTrack_remove_provider = app.findCollectionByNameOrId("LabelTrack");

  collection_LabelTrack_remove_provider.fields.removeByName("provider");

  app.save(collection_LabelTrack_remove_provider);

  const collection_LabelTrack_remove_processor = app.findCollectionByNameOrId("LabelTrack");

  collection_LabelTrack_remove_processor.fields.removeByName("processor");

  app.save(collection_LabelTrack_remove_processor);

  const collection_LabelTrack_remove_version = app.findCollectionByNameOrId("LabelTrack");

  collection_LabelTrack_remove_version.fields.removeByName("version");

  return app.save(collection_LabelTrack_remove_version);
}, (app) => {
  const collection_LabelTrack_restore_provider = app.findCollectionByNameOrId("LabelTrack");

  collection_LabelTrack_restore_provider.fields.add(new SelectField({
    name: "provider",
    required: true,
    maxSelect: 1,
    values: ["google_video_intelligence"]
  }));

  app.save(collection_LabelTrack_restore_provider);

  const collection_LabelTrack_restore_processor = app.findCollectionByNameOrId("LabelTrack");

  collection_LabelTrack_restore_processor.fields.add(new TextField({
    name: "processor",
    required: true
  }));

  app.save(collection_LabelTrack_restore_processor);

  const collection_LabelTrack_restore_version = app.findCollectionByNameOrId("LabelTrack");

  collection_LabelTrack_restore_version.fields.add(new NumberField({
    name: "version",
    required: false
  }));

  app.save(collection_LabelTrack_restore_version);

  const collection_LabelTrack_revert_LabelEntityRef = app.findCollectionByNameOrId("LabelTrack");
  const collection_LabelTrack_revert_LabelEntityRef_field = collection_LabelTrack_revert_LabelEntityRef.fields.getByName("LabelEntityRef");

  collection_LabelTrack_revert_LabelEntityRef_field.required = true;

  app.save(collection_LabelTrack_revert_LabelEntityRef);

  const collection_LabelTrack_revert_add_boundingBox = app.findCollectionByNameOrId("LabelTrack");

  collection_LabelTrack_revert_add_boundingBox.fields.removeByName("boundingBox");

  return app.save(collection_LabelTrack_revert_add_boundingBox);
});
