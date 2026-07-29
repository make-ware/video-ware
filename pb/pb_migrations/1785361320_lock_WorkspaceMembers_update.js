/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// WorkspaceMembers: updateRule -> null (superuser only).
//
// Mirrors shared/src/utils/collection-permissions.ts
// (`membershipCollectionPermissions`).
//
// A membership row is two relation fields and nothing else. Adding a member is a
// create, removing one is a delete, and nothing in webapp/, cli/, worker/ or
// shared/ ever PATCHes the collection — verified by grep.
//
// Leaving update open was an escalation, and 1785361310 makes it worse by turning
// membership into the boundary that protects other users' email addresses.
// PocketBase evaluates an update rule ONLY against the pre-update record
// (apis.recordUpdate refetches with the rule, then loads the body; there is no
// post-mutation re-check), so a member of workspace W could PATCH their own
// membership row's WorkspaceRef to any workspace id they knew and join it outright.
//
// Its own migration so it can be reverted independently of the read widening.
// ---------------------------------------------------------------------------
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pb_cg58dy19tzyzwb1");

  // update collection data
  unmarshal({
    "updateRule": null
  }, collection);

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pb_cg58dy19tzyzwb1");

  // update collection data
  unmarshal({
    "updateRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
  }, collection);

  return app.save(collection);
});
