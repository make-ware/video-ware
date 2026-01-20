/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_LabelSegments_modify_labelType = app.findCollectionByNameOrId("LabelSegments");
  const collection_LabelSegments_modify_labelType_field = collection_LabelSegments_modify_labelType.fields.getByName("labelType");

  collection_LabelSegments_modify_labelType_field.values = ["segment", "object", "person", "face"];

  return app.save(collection_LabelSegments_modify_labelType);
}, (app) => {
  const collection_LabelSegments_revert_labelType = app.findCollectionByNameOrId("LabelSegments");
  const collection_LabelSegments_revert_labelType_field = collection_LabelSegments_revert_labelType.fields.getByName("labelType");

  collection_LabelSegments_revert_labelType_field.values = ["object", "person", "face"];

  return app.save(collection_LabelSegments_revert_labelType);
});
