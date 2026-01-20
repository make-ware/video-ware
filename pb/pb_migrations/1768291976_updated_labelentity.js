/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_LabelEntity_modify_labelType = app.findCollectionByNameOrId("LabelEntity");
  const collection_LabelEntity_modify_labelType_field = collection_LabelEntity_modify_labelType.fields.getByName("labelType");

  collection_LabelEntity_modify_labelType_field.values = ["object", "shot", "person", "speech", "face", "segment", "text"];

  return app.save(collection_LabelEntity_modify_labelType);
}, (app) => {
  const collection_LabelEntity_revert_labelType = app.findCollectionByNameOrId("LabelEntity");
  const collection_LabelEntity_revert_labelType_field = collection_LabelEntity_revert_labelType.fields.getByName("labelType");

  collection_LabelEntity_revert_labelType_field.values = ["object", "shot", "person", "speech"];

  return app.save(collection_LabelEntity_revert_labelType);
});
