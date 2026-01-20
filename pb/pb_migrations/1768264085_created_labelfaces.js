/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_LabelFaces = new Collection({
    id: "pb_rufl1k4pwg3zofz",
    name: "LabelFaces",
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
      name: "LabelEntityRef",
      type: "relation",
      required: false,
      collectionId: "pb_mo92djgubjkikt4",
      maxSelect: 1,
      minSelect: 0,
      cascadeDelete: false,
    },
    {
      name: "trackId",
      type: "text",
      required: true,
      min: 1,
    },
    {
      name: "faceId",
      type: "text",
      required: false,
    },
    {
      name: "joyLikelihood",
      type: "text",
      required: false,
    },
    {
      name: "sorrowLikelihood",
      type: "text",
      required: false,
    },
    {
      name: "angerLikelihood",
      type: "text",
      required: false,
    },
    {
      name: "surpriseLikelihood",
      type: "text",
      required: false,
    },
    {
      name: "underExposedLikelihood",
      type: "text",
      required: false,
    },
    {
      name: "blurredLikelihood",
      type: "text",
      required: false,
    },
    {
      name: "headwearLikelihood",
      type: "text",
      required: false,
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
      name: "avgConfidence",
      type: "number",
      required: false,
    },
    {
      name: "metadata",
      type: "json",
      required: false,
    },
    {
      name: "faceHash",
      type: "text",
      required: true,
      min: 1,
    },
  ],
    indexes: [
    "CREATE UNIQUE INDEX idx_label_face_hash ON LabelFace (faceHash)",
    "CREATE INDEX idx_label_face_workspace ON LabelFace (WorkspaceRef)",
    "CREATE INDEX idx_label_face_media ON LabelFace (MediaRef)",
    "CREATE INDEX idx_label_face_track ON LabelFace (trackId)",
  ],
  });

  return app.save(collection_LabelFaces);
}, (app) => {
  const collection_LabelFaces = app.findCollectionByNameOrId("LabelFaces");
  return app.delete(collection_LabelFaces);
});
