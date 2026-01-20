/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_LabelSpeech_add_LabelTrackRef_0 = app.findCollectionByNameOrId("LabelSpeech");

  collection_LabelSpeech_add_LabelTrackRef_0.fields.add(new RelationField({
    name: "LabelTrackRef",
    required: false,
    collectionId: "pb_03xhgjzhymxc1pg",
    maxSelect: 1,
    minSelect: 0,
    cascadeDelete: false
  }));

  app.save(collection_LabelSpeech_add_LabelTrackRef_0);

  const collection_LabelSpeech_add_LabelEntityRef_1 = app.findCollectionByNameOrId("LabelSpeech");

  collection_LabelSpeech_add_LabelEntityRef_1.fields.add(new RelationField({
    name: "LabelEntityRef",
    required: false,
    collectionId: "pb_mo92djgubjkikt4",
    maxSelect: 1,
    minSelect: 0,
    cascadeDelete: false
  }));

  app.save(collection_LabelSpeech_add_LabelEntityRef_1);

  const collection_LabelSpeech_add_start_2 = app.findCollectionByNameOrId("LabelSpeech");

  collection_LabelSpeech_add_start_2.fields.add(new NumberField({
    name: "start",
    required: false,
    min: 0
  }));

  app.save(collection_LabelSpeech_add_start_2);

  const collection_LabelSpeech_add_end_3 = app.findCollectionByNameOrId("LabelSpeech");

  collection_LabelSpeech_add_end_3.fields.add(new NumberField({
    name: "end",
    required: false,
    min: 0
  }));

  app.save(collection_LabelSpeech_add_end_3);

  const collection_LabelSpeech_modify_duration = app.findCollectionByNameOrId("LabelSpeech");
  const collection_LabelSpeech_modify_duration_field = collection_LabelSpeech_modify_duration.fields.getByName("duration");

  collection_LabelSpeech_modify_duration_field.min = 0;

  app.save(collection_LabelSpeech_modify_duration);

  const collection_LabelSpeech_modify_confidence = app.findCollectionByNameOrId("LabelSpeech");
  const collection_LabelSpeech_modify_confidence_field = collection_LabelSpeech_modify_confidence.fields.getByName("confidence");

  collection_LabelSpeech_modify_confidence_field.min = 0;
  collection_LabelSpeech_modify_confidence_field.max = 1;

  app.save(collection_LabelSpeech_modify_confidence);

  const collection_LabelSpeech_remove_startTime = app.findCollectionByNameOrId("LabelSpeech");

  collection_LabelSpeech_remove_startTime.fields.removeByName("startTime");

  app.save(collection_LabelSpeech_remove_startTime);

  const collection_LabelSpeech_remove_endTime = app.findCollectionByNameOrId("LabelSpeech");

  collection_LabelSpeech_remove_endTime.fields.removeByName("endTime");

  return app.save(collection_LabelSpeech_remove_endTime);
}, (app) => {
  const collection_LabelSpeech_restore_startTime = app.findCollectionByNameOrId("LabelSpeech");

  collection_LabelSpeech_restore_startTime.fields.add(new NumberField({
    name: "startTime",
    required: false
  }));

  app.save(collection_LabelSpeech_restore_startTime);

  const collection_LabelSpeech_restore_endTime = app.findCollectionByNameOrId("LabelSpeech");

  collection_LabelSpeech_restore_endTime.fields.add(new NumberField({
    name: "endTime",
    required: false
  }));

  app.save(collection_LabelSpeech_restore_endTime);

  const collection_LabelSpeech_revert_duration = app.findCollectionByNameOrId("LabelSpeech");
  const collection_LabelSpeech_revert_duration_field = collection_LabelSpeech_revert_duration.fields.getByName("duration");

  collection_LabelSpeech_revert_duration_field.min = null;

  app.save(collection_LabelSpeech_revert_duration);

  const collection_LabelSpeech_revert_confidence = app.findCollectionByNameOrId("LabelSpeech");
  const collection_LabelSpeech_revert_confidence_field = collection_LabelSpeech_revert_confidence.fields.getByName("confidence");

  collection_LabelSpeech_revert_confidence_field.min = null;
  collection_LabelSpeech_revert_confidence_field.max = null;

  app.save(collection_LabelSpeech_revert_confidence);

  const collection_LabelSpeech_revert_add_LabelTrackRef = app.findCollectionByNameOrId("LabelSpeech");

  collection_LabelSpeech_revert_add_LabelTrackRef.fields.removeByName("LabelTrackRef");

  app.save(collection_LabelSpeech_revert_add_LabelTrackRef);

  const collection_LabelSpeech_revert_add_LabelEntityRef = app.findCollectionByNameOrId("LabelSpeech");

  collection_LabelSpeech_revert_add_LabelEntityRef.fields.removeByName("LabelEntityRef");

  app.save(collection_LabelSpeech_revert_add_LabelEntityRef);

  const collection_LabelSpeech_revert_add_start = app.findCollectionByNameOrId("LabelSpeech");

  collection_LabelSpeech_revert_add_start.fields.removeByName("start");

  app.save(collection_LabelSpeech_revert_add_start);

  const collection_LabelSpeech_revert_add_end = app.findCollectionByNameOrId("LabelSpeech");

  collection_LabelSpeech_revert_add_end.fields.removeByName("end");

  return app.save(collection_LabelSpeech_revert_add_end);
});
