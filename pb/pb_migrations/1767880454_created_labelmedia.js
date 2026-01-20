/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_LabelMedia = new Collection({
    id: "pb_e6945xany11rwwa",
    name: "LabelMedia",
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
      name: "MediaRef",
      type: "relation",
      required: true,
      collectionId: "pb_1q5cu7dybj36pxm",
      maxSelect: 1,
      minSelect: 0,
      cascadeDelete: false,
    },
    {
      name: "version",
      type: "number",
      required: false,
    },
    {
      name: "processors",
      type: "json",
      required: false,
    },
    {
      name: "labelDetectionProcessedAt",
      type: "text",
      required: false,
    },
    {
      name: "labelDetectionProcessor",
      type: "text",
      required: false,
    },
    {
      name: "segmentLabelCount",
      type: "number",
      required: false,
    },
    {
      name: "shotLabelCount",
      type: "number",
      required: false,
    },
    {
      name: "shotCount",
      type: "number",
      required: false,
    },
    {
      name: "objectTrackingProcessedAt",
      type: "text",
      required: false,
    },
    {
      name: "objectTrackingProcessor",
      type: "text",
      required: false,
    },
    {
      name: "objectCount",
      type: "number",
      required: false,
    },
    {
      name: "objectTrackCount",
      type: "number",
      required: false,
    },
    {
      name: "faceDetectionProcessedAt",
      type: "text",
      required: false,
    },
    {
      name: "faceDetectionProcessor",
      type: "text",
      required: false,
    },
    {
      name: "faceCount",
      type: "number",
      required: false,
    },
    {
      name: "faceTrackCount",
      type: "number",
      required: false,
    },
    {
      name: "personDetectionProcessedAt",
      type: "text",
      required: false,
    },
    {
      name: "personDetectionProcessor",
      type: "text",
      required: false,
    },
    {
      name: "personCount",
      type: "number",
      required: false,
    },
    {
      name: "personTrackCount",
      type: "number",
      required: false,
    },
    {
      name: "speechTranscriptionProcessedAt",
      type: "text",
      required: false,
    },
    {
      name: "speechTranscriptionProcessor",
      type: "text",
      required: false,
    },
    {
      name: "transcript",
      type: "text",
      required: false,
    },
    {
      name: "transcriptLength",
      type: "number",
      required: false,
    },
    {
      name: "wordCount",
      type: "number",
      required: false,
    },
    {
      name: "labelData",
      type: "json",
      required: false,
    },
    {
      name: "labels",
      type: "json",
      required: false,
    },
    {
      name: "objects",
      type: "json",
      required: false,
    },
    {
      name: "sceneChanges",
      type: "json",
      required: false,
    },
    {
      name: "transcription",
      type: "json",
      required: false,
    },
    {
      name: "intelligenceProcessedAt",
      type: "text",
      required: false,
    },
    {
      name: "processor",
      type: "text",
      required: false,
    },
  ],
    indexes: [],
  });

  return app.save(collection_LabelMedia);
}, (app) => {
  const collection_LabelMedia = app.findCollectionByNameOrId("LabelMedia");
  return app.delete(collection_LabelMedia);
});
