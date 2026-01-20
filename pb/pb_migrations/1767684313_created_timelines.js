/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_Timelines = new Collection({
    id: "pb_8la546it5zge3cv",
    name: "Timelines",
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
      name: "WorkspaceRef",
      type: "relation",
      required: true,
      collectionId: "pb_6znl9bq7apv0rcg",
      maxSelect: 1,
      minSelect: 0,
      cascadeDelete: false,
    },
    {
      name: "duration",
      type: "number",
      required: false,
      min: 0,
    },
    {
      name: "version",
      type: "number",
      required: false,
      min: 1,
    },
    {
      name: "editList",
      type: "json",
      required: false,
    },
    {
      name: "createdBy",
      type: "relation",
      required: false,
      collectionId: "_pb_users_auth_",
      maxSelect: 1,
      minSelect: 0,
      cascadeDelete: false,
    },
  ],
    indexes: [],
  });

  return app.save(collection_Timelines);
}, (app) => {
  const collection_Timelines = app.findCollectionByNameOrId("Timelines");
  return app.delete(collection_Timelines);
});
