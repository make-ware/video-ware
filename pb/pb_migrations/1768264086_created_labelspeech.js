/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_LabelSpeech = new Collection({
    id: "pb_ngzw0tnzuw1i3dd",
    name: "LabelSpeech",
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
      cascadeDelete: false,
    },
    {
      name: "transcript",
      type: "text",
      required: true,
      min: 1,
    },
    {
      name: "startTime",
      type: "number",
      required: false,
    },
    {
      name: "endTime",
      type: "number",
      required: false,
    },
    {
      name: "duration",
      type: "number",
      required: false,
    },
    {
      name: "confidence",
      type: "number",
      required: false,
    },
    {
      name: "speakerTag",
      type: "number",
      required: false,
    },
    {
      name: "languageCode",
      type: "text",
      required: false,
    },
    {
      name: "words",
      type: "json",
      required: true,
    },
    {
      name: "metadata",
      type: "json",
      required: false,
    },
    {
      name: "speechHash",
      type: "text",
      required: true,
      min: 1,
    },
  ],
    indexes: [
    "CREATE UNIQUE INDEX idx_label_speech_hash ON LabelSpeech (speechHash)",
    "CREATE INDEX idx_label_speech_workspace ON LabelSpeech (WorkspaceRef)",
    "CREATE INDEX idx_label_speech_media ON LabelSpeech (MediaRef)",
  ],
  });

  return app.save(collection_LabelSpeech);
}, (app) => {
  const collection_LabelSpeech = app.findCollectionByNameOrId("LabelSpeech");
  return app.delete(collection_LabelSpeech);
});
