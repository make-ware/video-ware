/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pb_6znl9bq7apv0rcg")

  // update collection data
  unmarshal({
    "deleteRule": "WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
    "listRule": "WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
    "updateRule": "WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
    "viewRule": "WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pb_6znl9bq7apv0rcg")

  // update collection data
  unmarshal({
    "deleteRule": "@request.auth.id != \"\"",
    "listRule": "@request.auth.id != \"\"",
    "updateRule": "@request.auth.id != \"\"",
    "viewRule": "@request.auth.id != \"\""
  }, collection)

  return app.save(collection)
})
