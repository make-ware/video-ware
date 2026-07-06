/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// LabelSpeaker: speaker-diarized speech-to-text utterances.
//
// One row per continuous utterance by a single speaker, produced by STT
// providers that support speaker diarization (first provider: ElevenLabs
// Scribe). Unlike LabelSpeech (Google Speech, numeric speakerTag), speakers
// are identified by a provider string id (e.g. "speaker_0") stored in
// `speakerId`; word-precise timings live in the `words` JSON array. Rows link
// to the shared LabelEntity (one entity per speaker) and LabelTrack (one
// track per speaker spanning their utterances), mirroring LabelSpeech.
//
// MediaRef cascades: deleting a Media deletes its speaker labels (same rule
// the 1781900000_cascade_media_children migration applies to LabelSpeech).
// ---------------------------------------------------------------------------
migrate((app) => {
  const collection_LabelSpeaker = new Collection({
    id: "pb_lblspkr01a2b3c4",
    name: "LabelSpeaker",
    type: "base",
    listRule: "@request.auth.id != \"\"",
    viewRule: "@request.auth.id != \"\"",
    createRule: "@request.auth.id != \"\"",
    updateRule: "@request.auth.id != \"\"",
    deleteRule: "@request.auth.id != \"\"",
    manageRule: null,
    fields: [
    {
      name: "id",
      type: "text",
      required: true,
      autogeneratePattern: "[a-z0-9]{15}",
      hidden: false,
      id: "text3208210256",
      max: 15,
      min: 15,
      pattern: "^[a-z0-9]+$",
      presentable: false,
      primaryKey: true,
      system: true,
    },
    {
      name: "created",
      type: "autodate",
      required: true,
      hidden: false,
      id: "autodate2990389176",
      onCreate: true,
      onUpdate: false,
      presentable: false,
      system: false,
    },
    {
      name: "updated",
      type: "autodate",
      required: true,
      hidden: false,
      id: "autodate3332085495",
      onCreate: true,
      onUpdate: true,
      presentable: false,
      system: false,
    },
    {
      name: "WorkspaceRef",
      type: "relation",
      required: true,
      collectionId: "pb_6znl9bq7apv0rcg",
      maxSelect: 1,
      minSelect: 0,
      cascadeDelete: false,
    },
    {
      name: "MediaRef",
      type: "relation",
      required: true,
      collectionId: "pb_1q5cu7dybj36pxm",
      maxSelect: 1,
      minSelect: 0,
      cascadeDelete: true,
    },
    {
      name: "LabelEntityRef",
      type: "relation",
      required: false,
      collectionId: "pb_mo92djgubjkikt4",
      maxSelect: 1,
      minSelect: 0,
      cascadeDelete: false,
    },
    {
      name: "LabelTrackRef",
      type: "relation",
      required: false,
      collectionId: "pb_03xhgjzhymxc1pg",
      maxSelect: 1,
      minSelect: 0,
      cascadeDelete: false,
    },
    {
      name: "transcript",
      type: "text",
      required: true,
      min: 1,
    },
    {
      name: "start",
      type: "number",
      required: false,
      min: 0,
    },
    {
      name: "end",
      type: "number",
      required: false,
      min: 0,
    },
    {
      name: "duration",
      type: "number",
      required: false,
      min: 0,
    },
    {
      name: "confidence",
      type: "number",
      required: false,
      min: 0,
      max: 1,
    },
    {
      name: "speakerId",
      type: "text",
      required: true,
      min: 1,
    },
    {
      name: "languageCode",
      type: "text",
      required: false,
    },
    {
      name: "words",
      type: "json",
      required: false,
    },
    {
      name: "metadata",
      type: "json",
      required: false,
    },
    {
      name: "speakerHash",
      type: "text",
      required: true,
      min: 1,
    },
  ],
    indexes: [
      "CREATE UNIQUE INDEX idx_label_speaker_hash ON LabelSpeaker (speakerHash)",
      "CREATE INDEX idx_label_speaker_workspace ON LabelSpeaker (WorkspaceRef)",
      "CREATE INDEX idx_label_speaker_media ON LabelSpeaker (MediaRef)",
      "CREATE INDEX idx_label_speaker_media_range ON LabelSpeaker (MediaRef, start, \"end\")",
      "CREATE INDEX idx_label_speaker_media_speaker ON LabelSpeaker (MediaRef, speakerId)",
    ],
  });

  return app.save(collection_LabelSpeaker);
}, (app) => {
  const collection_LabelSpeaker = app.findCollectionByNameOrId("LabelSpeaker");
  return app.delete(collection_LabelSpeaker);
});
