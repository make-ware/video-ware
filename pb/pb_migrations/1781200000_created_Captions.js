/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_Captions = new Collection({
    id: "pb_cap5q8r2w7n4x1k",
    name: "Captions",
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
      cascadeDelete: true,
    },
    {
      name: "MediaRef",
      type: "relation",
      required: false,
      collectionId: "pb_1q5cu7dybj36pxm",
      maxSelect: 1,
      minSelect: 0,
      cascadeDelete: true,
    },
    {
      name: "UserRef",
      type: "relation",
      required: false,
      collectionId: "_pb_users_auth_",
      maxSelect: 1,
      minSelect: 0,
      cascadeDelete: false,
    },
    {
      name: "name",
      type: "text",
      required: false,
    },
    {
      name: "captionType",
      type: "select",
      required: true,
      maxSelect: 1,
      values: ["caption", "title"],
    },
    {
      name: "text",
      type: "text",
      required: true,
    },
    {
      name: "cues",
      type: "json",
      required: false,
    },
    {
      name: "duration",
      type: "number",
      required: false,
      min: 0,
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
      name: "style",
      type: "json",
      required: false,
    },
    {
      name: "metadata",
      type: "json",
      required: false,
    },
  ],
    indexes: [
      "CREATE INDEX idx_captions_workspace ON Captions (WorkspaceRef)",
      "CREATE INDEX idx_captions_media ON Captions (MediaRef)",
    ],
  });

  return app.save(collection_Captions);
}, (app) => {
  const collection_Captions = app.findCollectionByNameOrId("Captions");
  return app.delete(collection_Captions);
});
