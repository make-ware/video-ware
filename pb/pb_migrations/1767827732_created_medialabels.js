/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_MediaLabels = new Collection({
    id: "pb_8jvvwmsbjqsb3bd",
    name: "MediaLabels",
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
      name: "labelData",
      type: "json",
      required: false,
    },
    {
      name: "version",
      type: "number",
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
  ],
    indexes: [],
  });

  return app.save(collection_MediaLabels);
}, (app) => {
  const collection_MediaLabels = app.findCollectionByNameOrId("MediaLabels");
  return app.delete(collection_MediaLabels);
});
