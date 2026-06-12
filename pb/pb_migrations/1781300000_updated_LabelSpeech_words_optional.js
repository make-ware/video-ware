/// <reference path="../pb_data/types.d.ts" />
// Manually-created transcripts have segment-level timing only; PocketBase
// treats [] as blank for required JSON fields, so creating them failed.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("LabelSpeech");
  const words = collection.fields.getByName("words");
  words.required = false;
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("LabelSpeech");
  const words = collection.fields.getByName("words");
  words.required = true;
  return app.save(collection);
});
