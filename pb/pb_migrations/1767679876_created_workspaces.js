/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_Workspaces = new Collection({
    id: "pb_6znl9bq7apv0rcg",
    name: "Workspaces",
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
      name: "name",
      type: "text",
      required: true,
    },
    {
      name: "slug",
      type: "text",
      required: false,
    },
    {
      name: "settings",
      type: "json",
      required: false,
    },
  ],
    indexes: [],
  });

  return app.save(collection_Workspaces);
}, (app) => {
  const collection_Workspaces = app.findCollectionByNameOrId("Workspaces");
  return app.delete(collection_Workspaces);
});
