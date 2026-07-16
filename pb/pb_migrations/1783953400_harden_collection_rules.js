/// <reference path="../pb_data/types.d.ts" />
// Production hardening: scope every collection's API rules to workspace
// membership (see shared/src/utils/collection-permissions.ts, the source of
// truth). Workspaces itself already landed in 1783896512_updated_Workspaces.js
// and is intentionally omitted. The worker authenticates as a superuser and
// bypasses all rules.
migrate((app) => {
  // Artifacts
  {
    const collection = app.findCollectionByNameOrId("pb_artifacts0001")

    // update collection data
    unmarshal({
      "createRule": null,
      "deleteRule": null,
      "listRule": "@request.auth.id != \"\" && (WorkspaceRef = \"\" || WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id)",
      "updateRule": null,
      "viewRule": "@request.auth.id != \"\" && (WorkspaceRef = \"\" || WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id)"
    }, collection)

    app.save(collection)
  }

  // Captions
  {
    const collection = app.findCollectionByNameOrId("pb_cap5q8r2w7n4x1k")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // ClipLabelSearch (view collection: list/view only)
  {
    const collection = app.findCollectionByNameOrId("pb_cliplabelsrch01")

    // update collection data
    unmarshal({
      "listRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // Directories
  {
    const collection = app.findCollectionByNameOrId("pb_directories0001")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // Entities
  {
    const collection = app.findCollectionByNameOrId("pb_entity1a2b3c4d5")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // Files
  {
    const collection = app.findCollectionByNameOrId("pb_48ql3az7t9ok2mu")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // LabelEntity
  {
    const collection = app.findCollectionByNameOrId("pb_mo92djgubjkikt4")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // LabelFaces
  {
    const collection = app.findCollectionByNameOrId("pb_rufl1k4pwg3zofz")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // LabelJobs (no WorkspaceRef; scoped via MediaRef)
  {
    const collection = app.findCollectionByNameOrId("pb_64xagwh9qro4ta9")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.MediaRef.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "MediaRef.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "MediaRef.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "MediaRef.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "MediaRef.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // LabelObjects
  {
    const collection = app.findCollectionByNameOrId("pb_drwawwy88v6o6lk")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // LabelPerson
  {
    const collection = app.findCollectionByNameOrId("pb_3qcuf9dlte0h5l7")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // LabelSegments
  {
    const collection = app.findCollectionByNameOrId("pb_xupvefy1iknd24b")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // LabelShots
  {
    const collection = app.findCollectionByNameOrId("pb_z4b3eoz2y60p4sn")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // LabelSpeaker
  {
    const collection = app.findCollectionByNameOrId("pb_lblspkr01a2b3c4")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // LabelSpeech
  {
    const collection = app.findCollectionByNameOrId("pb_ngzw0tnzuw1i3dd")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // LabelText
  {
    const collection = app.findCollectionByNameOrId("pb_xqsvsxulvi60rx1")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // LabelTrack
  {
    const collection = app.findCollectionByNameOrId("pb_03xhgjzhymxc1pg")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // Media
  {
    const collection = app.findCollectionByNameOrId("pb_1q5cu7dybj36pxm")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // MediaClipLabels
  {
    const collection = app.findCollectionByNameOrId("pb_mcliplabels001")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // MediaClips
  {
    const collection = app.findCollectionByNameOrId("pb_v0io398cfx6qzc3")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // MediaRecommendations
  {
    const collection = app.findCollectionByNameOrId("pb_85qd7k3nik12v7r")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // Tasks
  {
    const collection = app.findCollectionByNameOrId("pb_rm2tsf1ujhh49zr")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // TimelineClips (scoped via TimelineRef)
  {
    const collection = app.findCollectionByNameOrId("pb_fb18j6mto8zli16")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.TimelineRef.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "TimelineRef.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "TimelineRef.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "TimelineRef.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "TimelineRef.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // TimelineRecommendations
  {
    const collection = app.findCollectionByNameOrId("pb_91w0ka5joz10lay")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // TimelineRenders
  {
    const collection = app.findCollectionByNameOrId("pb_r4hszz7ysc4fipc")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // TimelineTracks (scoped via TimelineRef)
  {
    const collection = app.findCollectionByNameOrId("pb_4j2ljpjxrs0nwcq")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.TimelineRef.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "TimelineRef.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "TimelineRef.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "TimelineRef.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "TimelineRef.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // Timelines
  {
    const collection = app.findCollectionByNameOrId("pb_8la546it5zge3cv")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // Uploads
  {
    const collection = app.findCollectionByNameOrId("pb_9exg70d9rw3imzq")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // UsageEvents
  {
    const collection = app.findCollectionByNameOrId("pb_6cjthn6upwmek2x")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }

  // WorkspaceMembers (creator's first membership is added by the
  // hook-workspaces-create / hook-users-create superuser hooks)
  {
    const collection = app.findCollectionByNameOrId("pb_cg58dy19tzyzwb1")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\" && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "deleteRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "listRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "updateRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id",
      "viewRule": "WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id"
    }, collection)

    app.save(collection)
  }
}, (app) => {
  // Artifacts
  {
    const collection = app.findCollectionByNameOrId("pb_artifacts0001")

    // update collection data
    unmarshal({
      "createRule": null,
      "deleteRule": null,
      "listRule": "@request.auth.id != \"\"",
      "updateRule": null,
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // Captions
  {
    const collection = app.findCollectionByNameOrId("pb_cap5q8r2w7n4x1k")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // ClipLabelSearch (view collection: list/view only)
  {
    const collection = app.findCollectionByNameOrId("pb_cliplabelsrch01")

    // update collection data
    unmarshal({
      "listRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // Directories
  {
    const collection = app.findCollectionByNameOrId("pb_directories0001")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // Entities
  {
    const collection = app.findCollectionByNameOrId("pb_entity1a2b3c4d5")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // Files
  {
    const collection = app.findCollectionByNameOrId("pb_48ql3az7t9ok2mu")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // LabelEntity
  {
    const collection = app.findCollectionByNameOrId("pb_mo92djgubjkikt4")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // LabelFaces
  {
    const collection = app.findCollectionByNameOrId("pb_rufl1k4pwg3zofz")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // LabelJobs
  {
    const collection = app.findCollectionByNameOrId("pb_64xagwh9qro4ta9")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // LabelObjects
  {
    const collection = app.findCollectionByNameOrId("pb_drwawwy88v6o6lk")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // LabelPerson
  {
    const collection = app.findCollectionByNameOrId("pb_3qcuf9dlte0h5l7")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // LabelSegments
  {
    const collection = app.findCollectionByNameOrId("pb_xupvefy1iknd24b")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // LabelShots
  {
    const collection = app.findCollectionByNameOrId("pb_z4b3eoz2y60p4sn")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // LabelSpeaker
  {
    const collection = app.findCollectionByNameOrId("pb_lblspkr01a2b3c4")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // LabelSpeech
  {
    const collection = app.findCollectionByNameOrId("pb_ngzw0tnzuw1i3dd")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // LabelText
  {
    const collection = app.findCollectionByNameOrId("pb_xqsvsxulvi60rx1")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // LabelTrack
  {
    const collection = app.findCollectionByNameOrId("pb_03xhgjzhymxc1pg")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // Media
  {
    const collection = app.findCollectionByNameOrId("pb_1q5cu7dybj36pxm")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // MediaClipLabels
  {
    const collection = app.findCollectionByNameOrId("pb_mcliplabels001")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // MediaClips
  {
    const collection = app.findCollectionByNameOrId("pb_v0io398cfx6qzc3")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // MediaRecommendations
  {
    const collection = app.findCollectionByNameOrId("pb_85qd7k3nik12v7r")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // Tasks
  {
    const collection = app.findCollectionByNameOrId("pb_rm2tsf1ujhh49zr")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // TimelineClips
  {
    const collection = app.findCollectionByNameOrId("pb_fb18j6mto8zli16")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // TimelineRecommendations
  {
    const collection = app.findCollectionByNameOrId("pb_91w0ka5joz10lay")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // TimelineRenders
  {
    const collection = app.findCollectionByNameOrId("pb_r4hszz7ysc4fipc")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // TimelineTracks
  {
    const collection = app.findCollectionByNameOrId("pb_4j2ljpjxrs0nwcq")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // Timelines
  {
    const collection = app.findCollectionByNameOrId("pb_8la546it5zge3cv")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // Uploads
  {
    const collection = app.findCollectionByNameOrId("pb_9exg70d9rw3imzq")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // UsageEvents
  {
    const collection = app.findCollectionByNameOrId("pb_6cjthn6upwmek2x")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }

  // WorkspaceMembers
  {
    const collection = app.findCollectionByNameOrId("pb_cg58dy19tzyzwb1")

    // update collection data
    unmarshal({
      "createRule": "@request.auth.id != \"\"",
      "deleteRule": "@request.auth.id != \"\"",
      "listRule": "@request.auth.id != \"\"",
      "updateRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\""
    }, collection)

    app.save(collection)
  }
})
