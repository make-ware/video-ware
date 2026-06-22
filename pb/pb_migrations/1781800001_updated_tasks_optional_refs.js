/// <reference path="../pb_data/types.d.ts" />
// System tasks (the `cleanup` task, created by the storageCleanup cron) are
// not scoped to a workspace or user, so WorkspaceRef and UserRef must be optional
// on Tasks. The webapp filters task lists by WorkspaceRef, so workspace-less tasks
// never surface in the UI.
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('Tasks');
    const workspaceRef = collection.fields.getByName('WorkspaceRef');
    if (workspaceRef) workspaceRef.required = false;
    const userRef = collection.fields.getByName('UserRef');
    if (userRef) userRef.required = false;
    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('Tasks');
    const workspaceRef = collection.fields.getByName('WorkspaceRef');
    if (workspaceRef) workspaceRef.required = true;
    const userRef = collection.fields.getByName('UserRef');
    if (userRef) userRef.required = true;
    return app.save(collection);
  }
);
