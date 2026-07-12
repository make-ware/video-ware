/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Workspace -> creator membership bootstrap
//
// When a workspace is created via the API by a normal (non-superuser) user,
// automatically add that user as a WorkspaceMembers row. This lets us lock
// WorkspaceMembers.createRule down to "existing members only" (see
// 1783753400_harden_collection_rules.js) while still allowing a user to create a
// brand-new workspace they immediately belong to — the webapp/CLI only POST the
// Workspace, never the membership.
//
// This is the *request* hook because it needs the authenticated caller
// (e.requestInfo().auth). The signup bootstrap in hook-users-create creates its
// workspace + membership programmatically via $app.save(), which does NOT fire
// request hooks, so there is no double membership.
//
// Self-contained: all logic lives inside the handler (pb_hooks run in isolated
// pooled runtimes with no shared top-level scope).
// ---------------------------------------------------------------------------
onRecordCreateRequest((e) => {
  // Capture the caller before persisting the workspace.
  const info = e.requestInfo();
  const auth = info ? info.auth : null;
  const isSuperuser = e.hasSuperuserAuth();

  // Persist the workspace (assigns e.record.id) and run the rest of the chain.
  e.next();

  try {
    // Only auto-enroll a normal end user. Superuser-created workspaces (admin
    // UI / worker) do not implicitly make the superuser a member. The only
    // non-superuser auth collection is `Users`, so `!isSuperuser && auth`
    // uniquely identifies an end user (guarding against a `users` vs `Users`
    // collection-name mismatch).
    if (isSuperuser || !auth) {
      return;
    }

    const workspaceId = e.record.id;
    const userId = auth.id;

    // Idempotency: never create a duplicate membership.
    try {
      $app.findFirstRecordByFilter(
        'WorkspaceMembers',
        'WorkspaceRef = {:w} && UserRef = {:u}',
        { w: workspaceId, u: userId }
      );
      return; // already a member
    } catch (notFound) {
      // No membership yet -> create one.
    }

    const members = $app.findCollectionByNameOrId('WorkspaceMembers');
    const member = new Record(members);
    member.set('WorkspaceRef', workspaceId);
    member.set('UserRef', userId);
    $app.save(member);
  } catch (error) {
    // Never fail the workspace create because the membership bootstrap failed.
    console.error('Failed to bootstrap workspace membership:', error);
  }
}, 'Workspaces');
