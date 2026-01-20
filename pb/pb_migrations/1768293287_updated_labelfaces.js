/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_LabelFaces_addidx_0 = app.findCollectionByNameOrId("LabelFaces");
  collection_LabelFaces_addidx_0.indexes.push("CREATE UNIQUE INDEX idx_label_face_hash ON LabelFaces (faceHash)");
  app.save(collection_LabelFaces_addidx_0);

  const collection_LabelFaces_addidx_1 = app.findCollectionByNameOrId("LabelFaces");
  collection_LabelFaces_addidx_1.indexes.push("CREATE INDEX idx_label_face_workspace ON LabelFaces (WorkspaceRef)");
  app.save(collection_LabelFaces_addidx_1);

  const collection_LabelFaces_addidx_2 = app.findCollectionByNameOrId("LabelFaces");
  collection_LabelFaces_addidx_2.indexes.push("CREATE INDEX idx_label_face_media ON LabelFaces (MediaRef)");
  app.save(collection_LabelFaces_addidx_2);

  const collection_LabelFaces_addidx_3 = app.findCollectionByNameOrId("LabelFaces");
  collection_LabelFaces_addidx_3.indexes.push("CREATE INDEX idx_label_face_track ON LabelFaces (LabelTrackRef)");
  return app.save(collection_LabelFaces_addidx_3);
}, (app) => {
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

  const collection_LabelFaces_revert_idx_3 = app.findCollectionByNameOrId("LabelFaces");
  const collection_LabelFaces_revert_idx_3_indexToRemove = collection_LabelFaces_revert_idx_3.indexes.findIndex(idx => idx === "CREATE INDEX idx_label_face_track ON LabelFaces (LabelTrackRef)");
  if (collection_LabelFaces_revert_idx_3_indexToRemove !== -1) {
    collection_LabelFaces_revert_idx_3.indexes.splice(collection_LabelFaces_revert_idx_3_indexToRemove, 1);
  }
  return app.save(collection_LabelFaces_revert_idx_3);
});
