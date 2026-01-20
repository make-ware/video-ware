/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_UsageEvents = new Collection({
    id: "pb_6cjthn6upwmek2x",
    name: "UsageEvents",
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
      name: "type",
      type: "text",
      required: true,
    },
    {
      name: "subtype",
      type: "text",
      required: true,
    },
    {
      name: "value",
      type: "number",
      required: false,
    },
    {
      name: "unit",
      type: "text",
      required: true,
    },
    {
      name: "metadata",
      type: "json",
      required: false,
    },
  ],
    indexes: [],
  });

  return app.save(collection_UsageEvents);
}, (app) => {
  const collection_UsageEvents = app.findCollectionByNameOrId("UsageEvents");
  return app.delete(collection_UsageEvents);
});
