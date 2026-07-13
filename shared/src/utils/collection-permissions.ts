/**
 * Workspace-membership-scoped PocketBase API rules.
 *
 * Every workspace-owned collection must only be readable/writable by users who
 * are members of the owning workspace. Membership lives in the `WorkspaceMembers`
 * collection (`WorkspaceRef` -> `Workspaces`, `UserRef` -> `users`). We express
 * "the current user is a member of the workspace reached from this record" with
 * the `WorkspaceMembers` back-relation:
 *
 *   <chain>.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id
 *
 * where `<chain>` is the relation path from the record to its `Workspaces`
 * record:
 *   - direct `WorkspaceRef`:          'WorkspaceRef'
 *   - nested via a timeline:          'TimelineRef.WorkspaceRef'
 *   - nested via media:               'MediaRef.WorkspaceRef'
 *   - the `Workspaces` record itself: '' (empty)
 *
 * NB: the worker authenticates as a PocketBase superuser and therefore bypasses
 * ALL of these rules. Only the webapp and CLI (regular user auth) are
 * constrained by them, which is exactly what we want — background processing
 * spans workspaces, user-facing access does not.
 */

export interface CollectionPermissions {
  listRule?: string | null;
  viewRule?: string | null;
  createRule?: string | null;
  updateRule?: string | null;
  deleteRule?: string | null;
}

/** Any authenticated (non-guest) user. */
export const AUTHENTICATED = '@request.auth.id != ""';

/** '' -> '', 'WorkspaceRef' -> 'WorkspaceRef.' */
function withDot(chain: string): string {
  return chain ? `${chain}.` : '';
}

/**
 * "The authenticated user is a member of the workspace reached via `chain`."
 * Evaluated against an existing record — use for list/view/update/delete.
 */
export function memberRule(chain: string): string {
  return `${withDot(chain)}WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id`;
}

/**
 * Same membership check, but against the *submitted* body for create rules where
 * the record does not exist yet. `@request.body.<chain>` resolves the submitted
 * relation id(s) and traverses to the target workspace's members, so a user can
 * only create records inside a workspace they already belong to.
 */
export function memberCreateRule(chain: string): string {
  return `${AUTHENTICATED} && @request.body.${withDot(chain)}WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id`;
}

/**
 * Full CRUD locked to membership of the workspace reached via `chain`
 * (default: a direct `WorkspaceRef` relation on the record).
 */
export function workspaceScopedPermissions(
  chain = 'WorkspaceRef'
): CollectionPermissions {
  const member = memberRule(chain);
  return {
    listRule: member,
    viewRule: member,
    createRule: memberCreateRule(chain),
    updateRule: member,
    deleteRule: member,
  };
}

/**
 * The `Workspaces` collection itself: visible/editable only to its members, but
 * any authenticated user may create one. The creator's membership is added
 * immediately afterwards server-side (the `hook-workspaces-create` request hook,
 * or the `hook-users-create` bootstrap for the signup workspace), so a freshly
 * created workspace is never orphaned from its creator.
 */
export const workspacesCollectionPermissions: CollectionPermissions = {
  listRule: memberRule(''),
  viewRule: memberRule(''),
  createRule: AUTHENTICATED,
  updateRule: memberRule(''),
  deleteRule: memberRule(''),
};

/**
 * Superuser-written, workspace-scoped reads. For collections the worker/hooks
 * own (create/update/delete = null => superuser only) whose rows carry an
 * OPTIONAL `WorkspaceRef`. Workspace-less system rows (e.g. cleanup artifacts)
 * stay readable to any authenticated user; workspace-scoped rows are members
 * only.
 */
export const superuserWriteWorkspaceReadPermissions: CollectionPermissions = {
  listRule: `${AUTHENTICATED} && (WorkspaceRef = "" || ${memberRule('WorkspaceRef')})`,
  viewRule: `${AUTHENTICATED} && (WorkspaceRef = "" || ${memberRule('WorkspaceRef')})`,
  createRule: null,
  updateRule: null,
  deleteRule: null,
};
