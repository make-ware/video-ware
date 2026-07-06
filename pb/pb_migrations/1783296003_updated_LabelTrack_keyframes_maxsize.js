/// <reference path="../pb_data/types.d.ts" />
// LabelTrack.keyframes ("the heavy data" — bounding boxes over time) was left at
// maxSize: 0, which PocketBase treats as its DefaultJSONFieldMaxSize of 1 MB
// (1048576 bytes). Object tracks over long/dense videos exceed that, so the
// record create fails with validation_json_size_limit and the track (plus its
// child LabelObjects) is dropped. Lift the cap so real tracks fit.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("LabelTrack");

  const keyframes = collection.fields.getByName("keyframes");
  keyframes.maxSize = 10485760; // 10 MB

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("LabelTrack");

  const keyframes = collection.fields.getByName("keyframes");
  keyframes.maxSize = 0; // revert to PocketBase default (1 MB)

  return app.save(collection);
});
