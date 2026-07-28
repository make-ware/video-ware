/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// TimelineRenders: require WorkspaceRef.
//
// The field was added as optional in 1781600001_extend_TimelineRenders, in the
// same batch that relaxed FileRef (which the worker fills in on completion).
// WorkspaceRef never needed that latitude: the only writer copies it from the
// parent timeline (webapp/src/services/timeline.ts -> timelineRenderMutator
// .create), and TimelineRenderInputSchema already rejects an empty value. The
// DB was simply never tightened to match, so `@project/shared` has been
// declaring it required while PocketBase accepted a blank.
//
// Closing that gap matters because every render list is filtered by
// WorkspaceRef — a workspace-less row would be invisible in the UI but still
// hold a render task and an output file.
//
// Deliberately NOT applied to Tasks.WorkspaceRef, which 1781800001 relaxed on
// purpose so the storageCleanup cron can create workspace-less system tasks.
// ---------------------------------------------------------------------------
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("TimelineRenders");

    // required alone drives non-emptiness; minSelect stays 0, matching every
    // other required relation in the schema (Media.WorkspaceRef, etc.).
    const workspaceRef = collection.fields.getByName("WorkspaceRef");
    workspaceRef.required = true;

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("TimelineRenders");

    const workspaceRef = collection.fields.getByName("WorkspaceRef");
    workspaceRef.required = false;

    return app.save(collection);
  }
);
