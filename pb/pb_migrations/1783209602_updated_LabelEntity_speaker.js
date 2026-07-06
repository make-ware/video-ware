/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// LabelEntity: allow the "speaker" label type and "elevenlabs" provider.
//
// The speaker transcription step (1783209600_created_LabelSpeaker) creates
// one LabelEntity per diarized speaker ("Speaker 1", "Speaker 2", ...) with
// labelType "speaker" and provider "elevenlabs"; both values must be present
// in the select fields or PocketBase rejects the insert.
// ---------------------------------------------------------------------------
migrate((app) => {
  const collection = app.findCollectionByNameOrId("LabelEntity");

  const labelType = collection.fields.getByName("labelType");
  if (!labelType.values.includes("speaker")) {
    labelType.values.push("speaker");
  }

  const provider = collection.fields.getByName("provider");
  if (!provider.values.includes("elevenlabs")) {
    provider.values.push("elevenlabs");
  }

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("LabelEntity");

  const labelType = collection.fields.getByName("labelType");
  labelType.values = labelType.values.filter((v) => v !== "speaker");

  const provider = collection.fields.getByName("provider");
  provider.values = provider.values.filter((v) => v !== "elevenlabs");

  return app.save(collection);
});
