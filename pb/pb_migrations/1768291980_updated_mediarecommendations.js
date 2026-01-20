/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_MediaRecommendations_modify_labelType = app.findCollectionByNameOrId("MediaRecommendations");
  const collection_MediaRecommendations_modify_labelType_field = collection_MediaRecommendations_modify_labelType.fields.getByName("labelType");

  collection_MediaRecommendations_modify_labelType_field.values = ["object", "shot", "person", "face", "speech", "segment", "text"];

  return app.save(collection_MediaRecommendations_modify_labelType);
}, (app) => {
  const collection_MediaRecommendations_revert_labelType = app.findCollectionByNameOrId("MediaRecommendations");
  const collection_MediaRecommendations_revert_labelType_field = collection_MediaRecommendations_revert_labelType.fields.getByName("labelType");

  collection_MediaRecommendations_revert_labelType_field.values = ["object", "shot", "person", "speech"];

  return app.save(collection_MediaRecommendations_revert_labelType);
});
