/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_LabelSegments_add_labelType_0 = app.findCollectionByNameOrId("LabelSegments");

  collection_LabelSegments_add_labelType_0.fields.add(new SelectField({
    name: "labelType",
    required: true,
    maxSelect: 1,
    values: ["object", "person", "face"]
  }));

  return app.save(collection_LabelSegments_add_labelType_0);
}, (app) => {
  const collection_LabelSegments_revert_add_labelType = app.findCollectionByNameOrId("LabelSegments");

  collection_LabelSegments_revert_add_labelType.fields.removeByName("labelType");

  return app.save(collection_LabelSegments_revert_add_labelType);
});
