/// <reference path="../pb_data/types.d.ts" />
// ---------------------------------------------------------------------------
// Artifacts: durable deletion queue (tombstones) for storage blobs.
//
// PocketBase's cascadeDelete removes File records and PB-native blobs, but never
// the external blob behind Files.storageKey (S3/GCS, or a local-backend key). The
// files-artifact-tombstone hook inserts a row here when such a File is deleted,
// and the `cleanup` worker task drains the queue by deleting the blob via
// the shared StorageBackend. Superuser-only writes (worker + hooks).
// ---------------------------------------------------------------------------
migrate((app) => {
  const collection_Artifacts = new Collection({
    id: "pb_artifacts0001",
    name: "Artifacts",
    type: "base",
    listRule: "@request.auth.id != \"\"",
    viewRule: "@request.auth.id != \"\"",
    createRule: null,
    updateRule: null,
    deleteRule: null,
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
        name: "storageKey",
        type: "text",
        required: true,
      },
      {
        name: "fileSource",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["s3", "pocketbase", "gcs"],
      },
      {
        name: "status",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["pending", "deleted", "failed"],
      },
      {
        name: "reason",
        type: "text",
        required: false,
      },
      {
        name: "sourceCollection",
        type: "text",
        required: false,
      },
      {
        name: "sourceId",
        type: "text",
        required: false,
      },
      {
        name: "attempts",
        type: "number",
        required: false,
        min: 0,
      },
      {
        name: "errorLog",
        type: "text",
        required: false,
      },
      {
        name: "WorkspaceRef",
        type: "relation",
        required: false,
        collectionId: "pb_6znl9bq7apv0rcg",
        maxSelect: 1,
        minSelect: 0,
        cascadeDelete: false,
      },
    ],
    indexes: [
      "CREATE INDEX `idx_Artifacts_status` ON `Artifacts` (`status`)",
    ],
  });

  return app.save(collection_Artifacts);
}, (app) => {
  const collection_Artifacts = app.findCollectionByNameOrId("Artifacts");
  return app.delete(collection_Artifacts);
});
