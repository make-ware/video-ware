/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// MediaClipLabels: add the "speaker" label type.
//
// LabelSpeaker (speaker-diarized STT utterances, created in 1783209600) joins
// MediaClips the same way every other label collection does: one optional
// Label*Ref per type, exactly one set per row. This migration:
//   - adds the LabelSpeakerRef relation (cascade: deleting the label deletes
//     the edge, matching the other Label*Refs)
//   - allows "speaker" in the labelType select
//   - indexes LabelSpeakerRef and widens the duplicate-edge unique index to
//     include it
// ---------------------------------------------------------------------------

const OLD_UNIQUE_INDEX =
  "CREATE UNIQUE INDEX idx_mediaclip_labels_unique ON MediaClipLabels (MediaClipRef, labelType, LabelObjectRef, LabelShotRef, LabelPersonRef, LabelSpeechRef, LabelFaceRef, LabelSegmentRef, LabelTextRef)";
const NEW_UNIQUE_INDEX =
  "CREATE UNIQUE INDEX idx_mediaclip_labels_unique ON MediaClipLabels (MediaClipRef, labelType, LabelObjectRef, LabelShotRef, LabelPersonRef, LabelSpeechRef, LabelSpeakerRef, LabelFaceRef, LabelSegmentRef, LabelTextRef)";
const SPEAKER_INDEX =
  "CREATE INDEX idx_mediaclip_labels_speaker ON MediaClipLabels (LabelSpeakerRef)";

migrate((app) => {
  const collection = app.findCollectionByNameOrId("MediaClipLabels");

  collection.fields.add(new RelationField({
    name: "LabelSpeakerRef",
    required: false,
    collectionId: "pb_lblspkr01a2b3c4", // LabelSpeaker
    maxSelect: 1,
    minSelect: 0,
    cascadeDelete: true,
  }));

  const labelType = collection.fields.getByName("labelType");
  if (!labelType.values.includes("speaker")) {
    labelType.values.push("speaker");
  }

  collection.indexes = collection.indexes
    .filter((idx) => idx !== OLD_UNIQUE_INDEX && idx !== SPEAKER_INDEX)
    .concat([SPEAKER_INDEX, NEW_UNIQUE_INDEX]);

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("MediaClipLabels");

  collection.fields.removeByName("LabelSpeakerRef");

  const labelType = collection.fields.getByName("labelType");
  labelType.values = labelType.values.filter((v) => v !== "speaker");

  collection.indexes = collection.indexes
    .filter((idx) => idx !== NEW_UNIQUE_INDEX && idx !== SPEAKER_INDEX)
    .concat([OLD_UNIQUE_INDEX]);

  return app.save(collection);
});
