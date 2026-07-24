/// <reference path="../pb_data/types.d.ts" />
// ---------------------------------------------------------------------------
// WatchFolderImports: append-only ledger for the worker's S3 watch-folder
// importer. One row per attempted (key, etag) pair — the UNIQUE index on
// (key, etag) doubles as the atomic claim between concurrent workers, and a
// row existing at all (any status) burns the pair forever: the watcher never
// reattempts an import it has a row for. Superuser-only writes (the worker);
// workspace members may read rows scoped to their workspace.
// ---------------------------------------------------------------------------
migrate((app) => {
  const collection_WatchFolderImports = new Collection({
    id: "pb_watchimports01",
    name: "WatchFolderImports",
    type: "base",
    listRule: "@request.auth.id != \"\" && (WorkspaceRef = \"\" || WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id)",
    viewRule: "@request.auth.id != \"\" && (WorkspaceRef = \"\" || WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id)",
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
        name: "key",
        type: "text",
        required: true,
      },
      {
        name: "etag",
        type: "text",
        required: true,
      },
      {
        name: "size",
        type: "number",
        required: false,
        min: 0,
      },
      {
        name: "status",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["importing", "imported", "failed", "skipped"],
      },
      {
        name: "error",
        type: "text",
        required: false,
      },
      {
        name: "UploadRef",
        type: "relation",
        required: false,
        collectionId: "pb_9exg70d9rw3imzq",
        maxSelect: 1,
        minSelect: 0,
        cascadeDelete: false,
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
      "CREATE UNIQUE INDEX `idx_WatchFolderImports_key_etag` ON `WatchFolderImports` (`key`, `etag`)",
      "CREATE INDEX `idx_WatchFolderImports_status` ON `WatchFolderImports` (`status`)",
    ],
  });

  return app.save(collection_WatchFolderImports);
}, (app) => {
  const collection_WatchFolderImports = app.findCollectionByNameOrId("WatchFolderImports");
  return app.delete(collection_WatchFolderImports);
});
