/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_TimelineTracks = new Collection({
    id: "pb_4j2ljpjxrs0nwcq",
    name: "TimelineTracks",
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
      name: "name",
      type: "text",
      required: false,
    },
    {
      name: "layer",
      type: "number",
      required: false,
      min: 0,
    },
    {
      name: "volume",
      type: "number",
      required: false,
      min: 0,
      max: 1,
    },
    {
      name: "opacity",
      type: "number",
      required: false,
      min: 0,
      max: 1,
    },
    {
      name: "isMuted",
      type: "bool",
      required: false,
    },
    {
      name: "isLocked",
      type: "bool",
      required: false,
    },
  ],
    indexes: [],
  });

  return app.save(collection_TimelineTracks);
}, (app) => {
  const collection_TimelineTracks = app.findCollectionByNameOrId("TimelineTracks");
  return app.delete(collection_TimelineTracks);
});
