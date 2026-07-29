/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// POST /api/vw/workspaces/{workspaceId}/members     {"email": "..."}
//
// Add an existing account to a workspace by its exact email address.
//
// Why an elevated endpoint rather than the plain WorkspaceMembers record API: the
// caller has to resolve an email to a user id first, and Users list/viewRule only
// exposes co-members — the very people already in a workspace with them. So the
// email -> id lookup has to happen server-side as superuser ($app.* ignores API
// rules).
//
// Authorization, in order:
//   1. $apis.requireAuth() with NO collection filter — a valid record token from
//      any auth collection. Passing 'Users' would REJECT superusers.
//   2. The caller must already be a member of {workspaceId}. Superusers skip this,
//      consistent with the rest of the stack.
//
// Exact email match only — no prefix/substring/LIKE — so the endpoint cannot be
// walked to enumerate accounts. It does reveal whether one specific address is
// registered, which is weaker than the oracle PocketBase's own signup endpoint
// already gives away unauthenticated via its unique-email validation error.
//
// A non-member gets the SAME 404 as a missing workspace, so the endpoint is not a
// workspace-id oracle.
//
// Route shape: the "/api/vw/" prefix namespaces this away from PocketBase's own
// /api sub-routes (settings, collections, logs, backups, crons, files, batch,
// realtime, health, sql — all literal second segments) and matches the documented
// custom-route convention. Note routerAdd registers on the ROOT router, so the path
// is absolute. The email travels in the BODY, not the path: PocketBase's activity
// logger persists request URLs into _logs, and a /members/{email} route would
// archive every address ever looked up.
//
// Errors are THROWN, not swallowed. Unlike the fire-and-forget membership bootstrap
// in hook-workspaces-create, the caller here is a UI waiting on a status code.
//
// Self-contained: all logic lives inside the handler (pb_hooks run in isolated
// pooled runtimes with no shared top-level scope).
// ---------------------------------------------------------------------------
routerAdd(
  'POST',
  '/api/vw/workspaces/{workspaceId}/members',
  (e) => {
    const workspaceId = e.request.pathValue('workspaceId');
    if (!workspaceId) {
      throw new BadRequestError('Missing workspace id.');
    }

    const body = new DynamicModel({ email: '' });
    try {
      e.bindBody(body);
    } catch (parseErr) {
      throw new BadRequestError('Malformed request body; expected JSON.');
    }

    // Trim only — never lowercase. The Users email unique index carries no
    // COLLATE NOCASE, so $app.findAuthRecordByEmail and PocketBase's own password
    // login are both case-sensitive (core.FindAuthRecordByEmail /
    // apis.findRecordByIdentityField). Folding case here would resolve an account
    // that cannot actually sign in with that spelling.
    const email = String(body.email || '').trim();
    if (!email) {
      throw new BadRequestError('An email address is required.');
    }

    let workspace;
    try {
      workspace = $app.findRecordById('Workspaces', workspaceId);
    } catch (missingWorkspace) {
      throw new NotFoundError('Workspace not found.');
    }

    const caller = e.auth;
    if (!e.hasSuperuserAuth()) {
      if (!caller) {
        // requireAuth() should have handled this; belt-and-braces.
        throw new UnauthorizedError('Authentication required.');
      }
      try {
        $app.findFirstRecordByFilter(
          'WorkspaceMembers',
          'WorkspaceRef = {:w} && UserRef = {:u}',
          { w: workspace.id, u: caller.id }
        );
      } catch (notMember) {
        // Same response as a missing workspace, on purpose.
        throw new NotFoundError('Workspace not found.');
      }
    }

    // Exact-email lookup as superuser. This is the only reason the endpoint exists
    // — $app.findAuthRecordByEmail ignores API rules and asserts the collection is
    // an auth collection.
    let target;
    try {
      target = $app.findAuthRecordByEmail('Users', email);
    } catch (noAccount) {
      throw new NotFoundError('No account exists for that email address.');
    }

    // Idempotent: re-adding an existing member is a 200, not a duplicate row.
    // WorkspaceMembers also carries a UNIQUE (WorkspaceRef, UserRef) index
    // (1785361300_workspace_members_indexes.js), so a lost race fails at the
    // database rather than silently duplicating.
    try {
      const existing = $app.findFirstRecordByFilter(
        'WorkspaceMembers',
        'WorkspaceRef = {:w} && UserRef = {:u}',
        { w: workspace.id, u: target.id }
      );
      return e.json(200, {
        id: existing.id,
        WorkspaceRef: workspace.id,
        UserRef: target.id,
        created: false,
      });
    } catch (notYetAMember) {
      // Fall through and create.
    }

    const members = $app.findCollectionByNameOrId('WorkspaceMembers');
    const member = new Record(members);
    member.set('WorkspaceRef', workspace.id);
    member.set('UserRef', target.id);
    $app.save(member);

    return e.json(201, {
      id: member.id,
      WorkspaceRef: workspace.id,
      UserRef: target.id,
      created: true,
    });
  },
  $apis.requireAuth()
);
