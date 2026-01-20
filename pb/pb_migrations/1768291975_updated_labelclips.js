/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_LabelClips_add_LabelEntityRef_0 = app.findCollectionByNameOrId("LabelClips");

  collection_LabelClips_add_LabelEntityRef_0.fields.add(new RelationField({
    name: "LabelEntityRef",
    required: false,
    collectionId: "pb_mo92djgubjkikt4",
    maxSelect: 1,
    minSelect: 0,
    cascadeDelete: false
  }));

  app.save(collection_LabelClips_add_LabelEntityRef_0);

  const collection_LabelClips_add_LabelTrackRef_1 = app.findCollectionByNameOrId("LabelClips");

  collection_LabelClips_add_LabelTrackRef_1.fields.add(new RelationField({
    name: "LabelTrackRef",
    required: false,
    collectionId: "pb_03xhgjzhymxc1pg",
    maxSelect: 1,
    minSelect: 0,
    cascadeDelete: false
  }));

  app.save(collection_LabelClips_add_LabelTrackRef_1);

  const collection_LabelClips_add_labelHash_2 = app.findCollectionByNameOrId("LabelClips");

  collection_LabelClips_add_labelHash_2.fields.add(new TextField({
    name: "labelHash",
    required: true,
    min: 1
  }));

  app.save(collection_LabelClips_add_labelHash_2);

  const collection_LabelClips_modify_labelType = app.findCollectionByNameOrId("LabelClips");
  const collection_LabelClips_modify_labelType_field = collection_LabelClips_modify_labelType.fields.getByName("labelType");

  collection_LabelClips_modify_labelType_field.values = ["object", "shot", "person", "speech", "face", "segment", "text"];

  return app.save(collection_LabelClips_modify_labelType);
}, (app) => {
  const collection_LabelClips_revert_labelType = app.findCollectionByNameOrId("LabelClips");
  const collection_LabelClips_revert_labelType_field = collection_LabelClips_revert_labelType.fields.getByName("labelType");

  collection_LabelClips_revert_labelType_field.values = ["object", "shot", "person", "speech"];

  app.save(collection_LabelClips_revert_labelType);

  const collection_LabelClips_revert_add_LabelEntityRef = app.findCollectionByNameOrId("LabelClips");

  collection_LabelClips_revert_add_LabelEntityRef.fields.removeByName("LabelEntityRef");

  app.save(collection_LabelClips_revert_add_LabelEntityRef);

  const collection_LabelClips_revert_add_LabelTrackRef = app.findCollectionByNameOrId("LabelClips");

  collection_LabelClips_revert_add_LabelTrackRef.fields.removeByName("LabelTrackRef");

  app.save(collection_LabelClips_revert_add_LabelTrackRef);

  const collection_LabelClips_revert_add_labelHash = app.findCollectionByNameOrId("LabelClips");

  collection_LabelClips_revert_add_labelHash.fields.removeByName("labelHash");

  return app.save(collection_LabelClips_revert_add_labelHash);
});
