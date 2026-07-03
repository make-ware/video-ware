/// <reference path="../pb_data/types.d.ts" />
// ---------------------------------------------------------------------------
// MediaClipLabels: explicit many-to-many join between MediaClips and the
// label collections. Each row records that a clip was created from (or is
// backed by) a specific label row — e.g. "this clip exists because of this
// portion of the transcript" or "this clip tracks this faceId".
//
// The ClipLabelSearch view intersects clips and labels implicitly by time
// overlap; this collection is the explicit provenance link, so it survives
// the clip being edited away from the label's time window. Exactly one
// Label*Ref is set per row, matching labelType. Edges cascade away when
// either side (clip or label) is deleted.
// ---------------------------------------------------------------------------
migrate((app) => {
  const collection_MediaClipLabels = new Collection({
    id: "pb_mcliplabels001",
    name: "MediaClipLabels",
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
        collectionId: "pb_6znl9bq7apv0rcg", // Workspaces
        maxSelect: 1,
        minSelect: 0,
        cascadeDelete: true,
      },
      {
        name: "MediaClipRef",
        type: "relation",
        required: true,
        collectionId: "pb_v0io398cfx6qzc3", // MediaClips
        maxSelect: 1,
        minSelect: 0,
        cascadeDelete: true,
      },
      {
        name: "labelType",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["object", "shot", "person", "speech", "face", "segment", "text"],
      },
      {
        name: "LabelObjectRef",
        type: "relation",
        required: false,
        collectionId: "pb_drwawwy88v6o6lk", // LabelObjects
        maxSelect: 1,
        minSelect: 0,
        cascadeDelete: true,
      },
      {
        name: "LabelShotRef",
        type: "relation",
        required: false,
        collectionId: "pb_z4b3eoz2y60p4sn", // LabelShots
        maxSelect: 1,
        minSelect: 0,
        cascadeDelete: true,
      },
      {
        name: "LabelPersonRef",
        type: "relation",
        required: false,
        collectionId: "pb_3qcuf9dlte0h5l7", // LabelPerson
        maxSelect: 1,
        minSelect: 0,
        cascadeDelete: true,
      },
      {
        name: "LabelSpeechRef",
        type: "relation",
        required: false,
        collectionId: "pb_ngzw0tnzuw1i3dd", // LabelSpeech
        maxSelect: 1,
        minSelect: 0,
        cascadeDelete: true,
      },
      {
        name: "LabelFaceRef",
        type: "relation",
        required: false,
        collectionId: "pb_rufl1k4pwg3zofz", // LabelFaces
        maxSelect: 1,
        minSelect: 0,
        cascadeDelete: true,
      },
      {
        name: "LabelSegmentRef",
        type: "relation",
        required: false,
        collectionId: "pb_xupvefy1iknd24b", // LabelSegments
        maxSelect: 1,
        minSelect: 0,
        cascadeDelete: true,
      },
      {
        name: "LabelTextRef",
        type: "relation",
        required: false,
        collectionId: "pb_xqsvsxulvi60rx1", // LabelText
        maxSelect: 1,
        minSelect: 0,
        cascadeDelete: true,
      },
      {
        name: "confidence",
        type: "number",
        required: false,
        min: 0,
        max: 1,
      },
      {
        name: "metadata",
        type: "json",
        required: false,
      },
    ],
    indexes: [
      "CREATE INDEX idx_mediaclip_labels_workspace ON MediaClipLabels (WorkspaceRef)",
      "CREATE INDEX idx_mediaclip_labels_clip ON MediaClipLabels (MediaClipRef)",
      "CREATE INDEX idx_mediaclip_labels_object ON MediaClipLabels (LabelObjectRef)",
      "CREATE INDEX idx_mediaclip_labels_shot ON MediaClipLabels (LabelShotRef)",
      "CREATE INDEX idx_mediaclip_labels_person ON MediaClipLabels (LabelPersonRef)",
      "CREATE INDEX idx_mediaclip_labels_speech ON MediaClipLabels (LabelSpeechRef)",
      "CREATE INDEX idx_mediaclip_labels_face ON MediaClipLabels (LabelFaceRef)",
      "CREATE INDEX idx_mediaclip_labels_segment ON MediaClipLabels (LabelSegmentRef)",
      "CREATE INDEX idx_mediaclip_labels_text ON MediaClipLabels (LabelTextRef)",
      // Empty relations are stored as '' so this rejects duplicate edges
      "CREATE UNIQUE INDEX idx_mediaclip_labels_unique ON MediaClipLabels (MediaClipRef, labelType, LabelObjectRef, LabelShotRef, LabelPersonRef, LabelSpeechRef, LabelFaceRef, LabelSegmentRef, LabelTextRef)",
    ],
  });

  return app.save(collection_MediaClipLabels);
}, (app) => {
  const collection_MediaClipLabels = app.findCollectionByNameOrId("MediaClipLabels");
  return app.delete(collection_MediaClipLabels);
});
