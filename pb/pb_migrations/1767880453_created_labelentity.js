/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_LabelEntity = new Collection({
    id: "pb_mo92djgubjkikt4",
    name: "LabelEntity",
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
      name: "labelType",
      type: "select",
      required: true,
      maxSelect: 1,
      values: ["object", "shot", "person", "speech"],
    },
    {
      name: "canonicalName",
      type: "text",
      required: true,
      min: 1,
    },
    {
      name: "provider",
      type: "select",
      required: true,
      maxSelect: 1,
      values: ["google_video_intelligence", "google_speech"],
    },
    {
      name: "processor",
      type: "text",
      required: true,
    },
    {
      name: "metadata",
      type: "json",
      required: false,
    },
    {
      name: "entityHash",
      type: "text",
      required: true,
      min: 1,
    },
  ],
    indexes: [
    "CREATE UNIQUE INDEX idx_label_entity_hash ON LabelEntity (entityHash)",
    "CREATE INDEX idx_label_entity_workspace_type ON LabelEntity (WorkspaceRef, labelType)",
    "CREATE INDEX idx_label_entity_canonical_name ON LabelEntity (canonicalName)",
  ],
  });

  return app.save(collection_LabelEntity);
}, (app) => {
  const collection_LabelEntity = app.findCollectionByNameOrId("LabelEntity");
  return app.delete(collection_LabelEntity);
});
