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
 * The `Users` collection reads the chain in REVERSE — see
 * `usersCollectionPermissions` below — hopping out of a user through the
 * `WorkspaceMembers.UserRef` back-relation before coming back in through
 * `WorkspaceMembers_via_WorkspaceRef`.
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
 * The `Users` collection. Reads are widened from "only yourself" to "yourself
 * plus anyone who shares a workspace with you", so a member list can render a
 * co-member's name and email — and so `expand=UserRef` resolves at all, since
 * PocketBase filters expanded records through the target collection's viewRule.
 *
 * The chain is the mirror image of `memberRule`: hop OUT of the user through the
 * `UserRef` back-relation to their memberships, to each of those workspaces, then
 * back IN through that workspace's members looking for the caller. That is 4
 * props / 3 joins; PocketBase's limit is 6 (core `maxNestedRels`).
 *
 * `?=` (any-of) is required at both back-relation hops: `WorkspaceMembers` has no
 * SINGLE-column unique index on either relation column, so PocketBase enables its
 * multi-match subquery and an un-prefixed `=` would mean "EVERY membership
 * reachable from this user is mine". The composite unique index on
 * (WorkspaceRef, UserRef) does not disturb that — `FindSingleColumnUniqueIndex`
 * only matches one-column indexes.
 *
 * Writes are deliberately NOT widened: create stays open (signup), update and
 * delete stay self-only. Reading a co-member never implies editing them.
 *
 * Email additionally needs `emailVisibility = true` on the record — PocketBase
 * masks the field during serialization for anyone but the owner, a superuser or a
 * manager (`core.Record.PublicExport`). See
 * `pb/pb_hooks/hook-users-email-visibility.pb.js`.
 */
export const usersCollectionPermissions: CollectionPermissions = {
  listRule: `id = @request.auth.id || ${memberRule('WorkspaceMembers_via_UserRef.WorkspaceRef')}`,
  viewRule: `id = @request.auth.id || ${memberRule('WorkspaceMembers_via_UserRef.WorkspaceRef')}`,
  createRule: '',
  updateRule: 'id = @request.auth.id',
  deleteRule: 'id = @request.auth.id',
};

/**
 * The `WorkspaceMembers` join collection. Identical to
 * `workspaceScopedPermissions()` except `updateRule` is null (superuser only).
 *
 * A membership row is two relation fields and nothing else — adding a member is a
 * create, removing one is a delete, and nothing in webapp/, cli/, worker/ or
 * shared/ ever PATCHes the collection. Leaving update open was an escalation:
 * PocketBase evaluates an update rule only against the PRE-update record
 * (`apis.recordUpdate` refetches with the rule, then loads the body; there is no
 * post-mutation re-check), so a member of workspace W could PATCH their own row's
 * `WorkspaceRef` to any workspace id they knew and join it outright.
 */
export const membershipCollectionPermissions: CollectionPermissions = {
  listRule: memberRule('WorkspaceRef'),
  viewRule: memberRule('WorkspaceRef'),
  createRule: memberCreateRule('WorkspaceRef'),
  updateRule: null,
  deleteRule: memberRule('WorkspaceRef'),
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
