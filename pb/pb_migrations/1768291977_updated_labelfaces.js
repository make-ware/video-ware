/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_LabelFaces_add_LabelTrackRef_0 = app.findCollectionByNameOrId("LabelFaces");

  collection_LabelFaces_add_LabelTrackRef_0.fields.add(new RelationField({
    name: "LabelTrackRef",
    required: false,
    collectionId: "pb_03xhgjzhymxc1pg",
    maxSelect: 1,
    minSelect: 0,
    cascadeDelete: false
  }));

  app.save(collection_LabelFaces_add_LabelTrackRef_0);

  const collection_LabelFaces_add_start_1 = app.findCollectionByNameOrId("LabelFaces");

  collection_LabelFaces_add_start_1.fields.add(new NumberField({
    name: "start",
    required: false,
    min: 0
  }));

  app.save(collection_LabelFaces_add_start_1);

  const collection_LabelFaces_add_end_2 = app.findCollectionByNameOrId("LabelFaces");

  collection_LabelFaces_add_end_2.fields.add(new NumberField({
    name: "end",
    required: false,
    min: 0
  }));

  app.save(collection_LabelFaces_add_end_2);

  const collection_LabelFaces_add_lookingAtCameraLikelihood_3 = app.findCollectionByNameOrId("LabelFaces");

  collection_LabelFaces_add_lookingAtCameraLikelihood_3.fields.add(new TextField({
    name: "lookingAtCameraLikelihood",
    required: false
  }));

  app.save(collection_LabelFaces_add_lookingAtCameraLikelihood_3);

  const collection_LabelFaces_add_embedding_4 = app.findCollectionByNameOrId("LabelFaces");

  collection_LabelFaces_add_embedding_4.fields.add(new JSONField({
    name: "embedding",
    required: false
  }));

  app.save(collection_LabelFaces_add_embedding_4);

  const collection_LabelFaces_add_embeddingModel_5 = app.findCollectionByNameOrId("LabelFaces");

  collection_LabelFaces_add_embeddingModel_5.fields.add(new TextField({
    name: "embeddingModel",
    required: false
  }));

  app.save(collection_LabelFaces_add_embeddingModel_5);

  const collection_LabelFaces_add_qualityScore_6 = app.findCollectionByNameOrId("LabelFaces");

  collection_LabelFaces_add_qualityScore_6.fields.add(new NumberField({
    name: "qualityScore",
    required: false,
    min: 0,
    max: 1
  }));

  app.save(collection_LabelFaces_add_qualityScore_6);

  const collection_LabelFaces_add_visualHash_7 = app.findCollectionByNameOrId("LabelFaces");

  collection_LabelFaces_add_visualHash_7.fields.add(new TextField({
    name: "visualHash",
    required: false
  }));

  app.save(collection_LabelFaces_add_visualHash_7);

  const collection_LabelFaces_add_version_8 = app.findCollectionByNameOrId("LabelFaces");

  collection_LabelFaces_add_version_8.fields.add(new NumberField({
    name: "version",
    required: false
  }));

  app.save(collection_LabelFaces_add_version_8);

  const collection_LabelFaces_modify_LabelEntityRef = app.findCollectionByNameOrId("LabelFaces");
  const collection_LabelFaces_modify_LabelEntityRef_field = collection_LabelFaces_modify_LabelEntityRef.fields.getByName("LabelEntityRef");

  collection_LabelFaces_modify_LabelEntityRef_field.required = true;

  app.save(collection_LabelFaces_modify_LabelEntityRef);

  const collection_LabelFaces_modify_duration = app.findCollectionByNameOrId("LabelFaces");
  const collection_LabelFaces_modify_duration_field = collection_LabelFaces_modify_duration.fields.getByName("duration");

  collection_LabelFaces_modify_duration_field.min = 0;

  app.save(collection_LabelFaces_modify_duration);

  const collection_LabelFaces_modify_avgConfidence = app.findCollectionByNameOrId("LabelFaces");
  const collection_LabelFaces_modify_avgConfidence_field = collection_LabelFaces_modify_avgConfidence.fields.getByName("avgConfidence");

  collection_LabelFaces_modify_avgConfidence_field.min = 0;
  collection_LabelFaces_modify_avgConfidence_field.max = 1;

  app.save(collection_LabelFaces_modify_avgConfidence);

  const collection_LabelFaces_modify_metadata = app.findCollectionByNameOrId("LabelFaces");
  const collection_LabelFaces_modify_metadata_field = collection_LabelFaces_modify_metadata.fields.getByName("metadata");

  collection_LabelFaces_modify_metadata_field.required = true;

  app.save(collection_LabelFaces_modify_metadata);

  // const collection_LabelFaces_remove_trackId = app.findCollectionByNameOrId("LabelFaces");

  // collection_LabelFaces_remove_trackId.fields.removeByName("trackId");

  // app.save(collection_LabelFaces_remove_trackId);

  const collection_LabelFaces_remove_startTime = app.findCollectionByNameOrId("LabelFaces");

  collection_LabelFaces_remove_startTime.fields.removeByName("startTime");

  app.save(collection_LabelFaces_remove_startTime);

  const collection_LabelFaces_remove_endTime = app.findCollectionByNameOrId("LabelFaces");

  collection_LabelFaces_remove_endTime.fields.removeByName("endTime");

  app.save(collection_LabelFaces_remove_endTime);

  const collection_LabelFaces_rmidx_0 = app.findCollectionByNameOrId("LabelFaces");
  const collection_LabelFaces_rmidx_0_indexToRemove = collection_LabelFaces_rmidx_0.indexes.findIndex(idx => idx === "CREATE UNIQUE INDEX idx_label_face_hash ON LabelFace (faceHash)");
  if (collection_LabelFaces_rmidx_0_indexToRemove !== -1) {
    collection_LabelFaces_rmidx_0.indexes.splice(collection_LabelFaces_rmidx_0_indexToRemove, 1);
  }
  app.save(collection_LabelFaces_rmidx_0);

  const collection_LabelFaces_rmidx_1 = app.findCollectionByNameOrId("LabelFaces");
  const collection_LabelFaces_rmidx_1_indexToRemove = collection_LabelFaces_rmidx_1.indexes.findIndex(idx => idx === "CREATE INDEX idx_label_face_workspace ON LabelFace (WorkspaceRef)");
  if (collection_LabelFaces_rmidx_1_indexToRemove !== -1) {
    collection_LabelFaces_rmidx_1.indexes.splice(collection_LabelFaces_rmidx_1_indexToRemove, 1);
  }
  app.save(collection_LabelFaces_rmidx_1);

  const collection_LabelFaces_rmidx_2 = app.findCollectionByNameOrId("LabelFaces");
  const collection_LabelFaces_rmidx_2_indexToRemove = collection_LabelFaces_rmidx_2.indexes.findIndex(idx => idx === "CREATE INDEX idx_label_face_media ON LabelFace (MediaRef)");
  if (collection_LabelFaces_rmidx_2_indexToRemove !== -1) {
    collection_LabelFaces_rmidx_2.indexes.splice(collection_LabelFaces_rmidx_2_indexToRemove, 1);
  }
  return app.save(collection_LabelFaces_rmidx_2);

  // const collection_LabelFaces_rmidx_3 = app.findCollectionByNameOrId("LabelFaces");
  // const collection_LabelFaces_rmidx_3_indexToRemove = collection_LabelFaces_rmidx_3.indexes.findIndex(idx => idx === "CREATE INDEX idx_label_face_track ON LabelFace (trackId)");
  // if (collection_LabelFaces_rmidx_3_indexToRemove !== -1) {
  //   collection_LabelFaces_rmidx_3.indexes.splice(collection_LabelFaces_rmidx_3_indexToRemove, 1);
  // }
  // return app.save(collection_LabelFaces_rmidx_3);
}, (app) => {
  const collection_LabelFaces_restore_idx_0 = app.findCollectionByNameOrId("LabelFaces");
  collection_LabelFaces_restore_idx_0.indexes.push("CREATE UNIQUE INDEX idx_label_face_hash ON LabelFace (faceHash)");
  app.save(collection_LabelFaces_restore_idx_0);

  const collection_LabelFaces_restore_idx_1 = app.findCollectionByNameOrId("LabelFaces");
  collection_LabelFaces_restore_idx_1.indexes.push("CREATE INDEX idx_label_face_workspace ON LabelFace (WorkspaceRef)");
  app.save(collection_LabelFaces_restore_idx_1);

  const collection_LabelFaces_restore_idx_2 = app.findCollectionByNameOrId("LabelFaces");
  collection_LabelFaces_restore_idx_2.indexes.push("CREATE INDEX idx_label_face_media ON LabelFace (MediaRef)");
  app.save(collection_LabelFaces_restore_idx_2);

  // const collection_LabelFaces_restore_idx_3 = app.findCollectionByNameOrId("LabelFaces");
  // collection_LabelFaces_restore_idx_3.indexes.push("CREATE INDEX idx_label_face_track ON LabelFace (trackId)");
  // app.save(collection_LabelFaces_restore_idx_3);

  const collection_LabelFaces_revert_idx_0 = app.findCollectionByNameOrId("LabelFaces");
  const collection_LabelFaces_revert_idx_0_indexToRemove = collection_LabelFaces_revert_idx_0.indexes.findIndex(idx => idx === "CREATE UNIQUE INDEX idx_label_face_hash ON LabelFaces (faceHash)");
  if (collection_LabelFaces_revert_idx_0_indexToRemove !== -1) {
    collection_LabelFaces_revert_idx_0.indexes.splice(collection_LabelFaces_revert_idx_0_indexToRemove, 1);
  }
  app.save(collection_LabelFaces_revert_idx_0);

  const collection_LabelFaces_revert_idx_1 = app.findCollectionByNameOrId("LabelFaces");
  const collection_LabelFaces_revert_idx_1_indexToRemove = collection_LabelFaces_revert_idx_1.indexes.findIndex(idx => idx === "CREATE INDEX idx_label_face_workspace ON LabelFaces (WorkspaceRef)");
  if (collection_LabelFaces_revert_idx_1_indexToRemove !== -1) {
    collection_LabelFaces_revert_idx_1.indexes.splice(collection_LabelFaces_revert_idx_1_indexToRemove, 1);
  }
  app.save(collection_LabelFaces_revert_idx_1);

  const collection_LabelFaces_revert_idx_2 = app.findCollectionByNameOrId("LabelFaces");
  const collection_LabelFaces_revert_idx_2_indexToRemove = collection_LabelFaces_revert_idx_2.indexes.findIndex(idx => idx === "CREATE INDEX idx_label_face_media ON LabelFaces (MediaRef)");
  if (collection_LabelFaces_revert_idx_2_indexToRemove !== -1) {
    collection_LabelFaces_revert_idx_2.indexes.splice(collection_LabelFaces_revert_idx_2_indexToRemove, 1);
  }
  app.save(collection_LabelFaces_revert_idx_2);

  // const collection_LabelFaces_revert_idx_3 = app.findCollectionByNameOrId("LabelFaces");
  // const collection_LabelFaces_revert_idx_3_indexToRemove = collection_LabelFaces_revert_idx_3.indexes.findIndex(idx => idx === "CREATE INDEX idx_label_face_track ON LabelFaces (LabelTrackRef)");
  // if (collection_LabelFaces_revert_idx_3_indexToRemove !== -1) {
  //   collection_LabelFaces_revert_idx_3.indexes.splice(collection_LabelFaces_revert_idx_3_indexToRemove, 1);
  // }
  // app.save(collection_LabelFaces_revert_idx_3);

  // const collection_LabelFaces_restore_trackId = app.findCollectionByNameOrId("LabelFaces");

  // collection_LabelFaces_restore_trackId.fields.add(new TextField({
  //   name: "trackId",
  //   required: true,
  //   min: 1
  // }));

  // app.save(collection_LabelFaces_restore_trackId);

  const collection_LabelFaces_restore_startTime = app.findCollectionByNameOrId("LabelFaces");

  collection_LabelFaces_restore_startTime.fields.add(new NumberField({
    name: "startTime",
    required: false
  }));

  app.save(collection_LabelFaces_restore_startTime);

  const collection_LabelFaces_restore_endTime = app.findCollectionByNameOrId("LabelFaces");

  collection_LabelFaces_restore_endTime.fields.add(new NumberField({
    name: "endTime",
    required: false
  }));

  app.save(collection_LabelFaces_restore_endTime);

  const collection_LabelFaces_revert_LabelEntityRef = app.findCollectionByNameOrId("LabelFaces");
  const collection_LabelFaces_revert_LabelEntityRef_field = collection_LabelFaces_revert_LabelEntityRef.fields.getByName("LabelEntityRef");

  collection_LabelFaces_revert_LabelEntityRef_field.required = false;

  app.save(collection_LabelFaces_revert_LabelEntityRef);

  const collection_LabelFaces_revert_duration = app.findCollectionByNameOrId("LabelFaces");
  const collection_LabelFaces_revert_duration_field = collection_LabelFaces_revert_duration.fields.getByName("duration");

  collection_LabelFaces_revert_duration_field.min = null;

  app.save(collection_LabelFaces_revert_duration);

  const collection_LabelFaces_revert_avgConfidence = app.findCollectionByNameOrId("LabelFaces");
  const collection_LabelFaces_revert_avgConfidence_field = collection_LabelFaces_revert_avgConfidence.fields.getByName("avgConfidence");

  collection_LabelFaces_revert_avgConfidence_field.min = null;
  collection_LabelFaces_revert_avgConfidence_field.max = null;

  app.save(collection_LabelFaces_revert_avgConfidence);

  const collection_LabelFaces_revert_metadata = app.findCollectionByNameOrId("LabelFaces");
  const collection_LabelFaces_revert_metadata_field = collection_LabelFaces_revert_metadata.fields.getByName("metadata");

  collection_LabelFaces_revert_metadata_field.required = false;

  app.save(collection_LabelFaces_revert_metadata);

  const collection_LabelFaces_revert_add_LabelTrackRef = app.findCollectionByNameOrId("LabelFaces");

  collection_LabelFaces_revert_add_LabelTrackRef.fields.removeByName("LabelTrackRef");

  app.save(collection_LabelFaces_revert_add_LabelTrackRef);

  const collection_LabelFaces_revert_add_start = app.findCollectionByNameOrId("LabelFaces");

  collection_LabelFaces_revert_add_start.fields.removeByName("start");

  app.save(collection_LabelFaces_revert_add_start);

  const collection_LabelFaces_revert_add_end = app.findCollectionByNameOrId("LabelFaces");

  collection_LabelFaces_revert_add_end.fields.removeByName("end");

  app.save(collection_LabelFaces_revert_add_end);

  const collection_LabelFaces_revert_add_lookingAtCameraLikelihood = app.findCollectionByNameOrId("LabelFaces");

  collection_LabelFaces_revert_add_lookingAtCameraLikelihood.fields.removeByName("lookingAtCameraLikelihood");

  app.save(collection_LabelFaces_revert_add_lookingAtCameraLikelihood);

  const collection_LabelFaces_revert_add_embedding = app.findCollectionByNameOrId("LabelFaces");

  collection_LabelFaces_revert_add_embedding.fields.removeByName("embedding");

  app.save(collection_LabelFaces_revert_add_embedding);

  const collection_LabelFaces_revert_add_embeddingModel = app.findCollectionByNameOrId("LabelFaces");

  collection_LabelFaces_revert_add_embeddingModel.fields.removeByName("embeddingModel");

  app.save(collection_LabelFaces_revert_add_embeddingModel);

  const collection_LabelFaces_revert_add_qualityScore = app.findCollectionByNameOrId("LabelFaces");

  collection_LabelFaces_revert_add_qualityScore.fields.removeByName("qualityScore");

  app.save(collection_LabelFaces_revert_add_qualityScore);

  const collection_LabelFaces_revert_add_visualHash = app.findCollectionByNameOrId("LabelFaces");

  collection_LabelFaces_revert_add_visualHash.fields.removeByName("visualHash");

  app.save(collection_LabelFaces_revert_add_visualHash);

  const collection_LabelFaces_revert_add_version = app.findCollectionByNameOrId("LabelFaces");

  collection_LabelFaces_revert_add_version.fields.removeByName("version");

  return app.save(collection_LabelFaces_revert_add_version);
});
