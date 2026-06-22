/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Users -> workspace bootstrap
//
// Create a workspace and a workspace membership when a new user is created.
// ---------------------------------------------------------------------------
onRecordAfterCreateSuccess((e) => {
  const userId = e.record.id;

  try {
    const workspacesCollection = $app.findCollectionByNameOrId('Workspaces');
    const workspaceMembersCollection =
      $app.findCollectionByNameOrId('WorkspaceMembers');

    const workspace = new Record(workspacesCollection);
    workspace.set('name', 'New');
    $app.save(workspace);

    const workspaceMember = new Record(workspaceMembersCollection);
    workspaceMember.set('WorkspaceRef', workspace.id);
    workspaceMember.set('UserRef', userId);
    $app.save(workspaceMember);
  } catch (error) {
    console.error('Error creating workspace for user:', userId, error);
  }
}, 'Users');
