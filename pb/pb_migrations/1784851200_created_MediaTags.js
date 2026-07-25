/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// MediaTags: manual whole-media entity tags — "this media features this
// Entity". One row per (media, entity) edge; the unique index makes tagging
// idempotent under races.
//
// Deliberately NOT a label collection: labels are provider detections with
// time-anchored segments/confidence/tracks, while a tag is a curator's
// statement about the media as a whole. It complements the two label-cluster
// link points (LabelTrack.EntityRef / LabelEntity.EntityRef) as a third,
// media-level Entity association.
//
// MediaRef and EntityRef cascade: deleting either endpoint deletes the edge.
// WorkspaceRef does not cascade (matches the other workspace-scoped
// collections); rules are the standard membership back-relation.
// ---------------------------------------------------------------------------
migrate((app) => {
  const collection_MediaTags = new Collection({
    id: "pb_mediatags00001",
    name: "MediaTags",
    type: "base",
    listRule: "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
    viewRule: "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
    createRule: "@request.auth.id != \"\" && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
    updateRule: "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
    deleteRule: "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
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
        name: "MediaRef",
        type: "relation",
        required: true,
        collectionId: "pb_1q5cu7dybj36pxm",
        maxSelect: 1,
        minSelect: 0,
        cascadeDelete: true,
      },
      {
        name: "EntityRef",
        type: "relation",
        required: true,
        collectionId: "pb_entity1a2b3c4d5",
        maxSelect: 1,
        minSelect: 0,
        cascadeDelete: true,
      },
      {
        name: "metadata",
        type: "json",
        required: false,
      },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_media_tags_media_entity ON MediaTags (MediaRef, EntityRef)",
      "CREATE INDEX idx_media_tags_entity ON MediaTags (EntityRef)",
      "CREATE INDEX idx_media_tags_workspace ON MediaTags (WorkspaceRef)",
    ],
  });

  return app.save(collection_MediaTags);
}, (app) => {
  const collection_MediaTags = app.findCollectionByNameOrId("MediaTags");
  return app.delete(collection_MediaTags);
});
