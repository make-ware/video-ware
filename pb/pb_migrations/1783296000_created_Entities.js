/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Entities: real-world identities (person, product, place, thing) that label
// clusters are manually linked to across media.
//
// Provider labels only carry generated ids scoped to one media ("speaker_0",
// GCVI face track ids); an Entity is the stable workspace-level handle those
// clusters resolve to. Two link points reference this collection:
//   - LabelTrack.EntityRef  (per-media instance: "this face track is Erik")
//   - LabelEntity.EntityRef (workspace-wide cluster: "'iPhone' objects are
//     this product")
// added in the 1783296001/1783296002 migrations. Track links take precedence.
//
// WorkspaceRef does not cascade (matches the other label-adjacent
// collections); deleting an Entity clears the EntityRef fields pointing at it
// rather than deleting label rows.
// ---------------------------------------------------------------------------
migrate((app) => {
  const collection_Entities = new Collection({
    id: "pb_entity1a2b3c4d5",
    name: "Entities",
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
      name: "name",
      type: "text",
      required: true,
      min: 1,
    },
    {
      name: "kind",
      type: "select",
      required: true,
      maxSelect: 1,
      values: ["person", "product", "place", "thing"],
    },
    {
      name: "aliases",
      type: "json",
      required: false,
    },
    {
      name: "description",
      type: "text",
      required: false,
    },
    {
      name: "metadata",
      type: "json",
      required: false,
    },
  ],
    indexes: [
      "CREATE UNIQUE INDEX idx_entities_workspace_kind_name ON Entities (WorkspaceRef, kind, name)",
      "CREATE INDEX idx_entities_workspace_kind ON Entities (WorkspaceRef, kind)",
    ],
  });

  return app.save(collection_Entities);
}, (app) => {
  const collection_Entities = app.findCollectionByNameOrId("Entities");
  return app.delete(collection_Entities);
});
