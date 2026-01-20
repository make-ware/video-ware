/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_TimelineRenders = new Collection({
    id: "pb_r4hszz7ysc4fipc",
    name: "TimelineRenders",
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
      name: "TimelineRef",
      type: "relation",
      required: true,
      collectionId: "pb_8la546it5zge3cv",
      maxSelect: 1,
      minSelect: 0,
      cascadeDelete: false,
    },
    {
      name: "FileRef",
      type: "relation",
      required: true,
      collectionId: "pb_48ql3az7t9ok2mu",
      maxSelect: 1,
      minSelect: 0,
      cascadeDelete: false,
    },
    {
      name: "timelineVersion",
      type: "number",
      required: false,
      min: 1,
    },
  ],
    indexes: [],
  });

  return app.save(collection_TimelineRenders);
}, (app) => {
  const collection_TimelineRenders = app.findCollectionByNameOrId("TimelineRenders");
  return app.delete(collection_TimelineRenders);
});
