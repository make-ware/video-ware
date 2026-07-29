import { describe, it, expect } from 'vitest';
import {
  AUTHENTICATED,
  memberRule,
  memberCreateRule,
  usersCollectionPermissions,
  membershipCollectionPermissions,
  workspacesCollectionPermissions,
} from '../collection-permissions';
import { UserCollection, WorkspaceMemberCollection } from '../../schema';

/**
 * Drift guard. These rule strings are the live PocketBase API rules — they are
 * copied verbatim into `pb/pb_migrations/1785361310_widen_Users_read_to_comembers.js`
 * and `1785361320_lock_WorkspaceMembers_update.js`, and there is no automated check
 * that the database matches. Pinning the exact literals means a refactor of
 * `memberRule`/`withDot` cannot silently rewrite every rule in the schema, and a
 * change here shows up as a failing test rather than as a permission hole.
 */
describe('memberRule', () => {
  it('emits the bare back-relation for the Workspaces record itself', () => {
    expect(memberRule('')).toBe(
      'WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id'
    );
  });

  it('prefixes a direct WorkspaceRef chain with a dot', () => {
    expect(memberRule('WorkspaceRef')).toBe(
      'WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id'
    );
  });

  it('composes the reverse chain used by the Users read rule', () => {
    // Out of the user via the UserRef back-relation -> their memberships -> each of
    // those workspaces -> back in through that workspace's members. 4 props / 3
    // joins; PocketBase's limit is 6.
    expect(memberRule('WorkspaceMembers_via_UserRef.WorkspaceRef')).toBe(
      'WorkspaceMembers_via_UserRef.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id'
    );
  });

  it('binds the submitted body for create rules', () => {
    expect(memberCreateRule('WorkspaceRef')).toBe(
      `${AUTHENTICATED} && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id`
    );
  });
});

describe('usersCollectionPermissions', () => {
  const CO_MEMBER_READ =
    'id = @request.auth.id || WorkspaceMembers_via_UserRef.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id';

  it('widens reads to co-members and leaves writes self-only', () => {
    expect(usersCollectionPermissions).toEqual({
      listRule: CO_MEMBER_READ,
      viewRule: CO_MEMBER_READ,
      // Open signup — unchanged.
      createRule: '',
      // Reading a co-member must never imply editing or deleting them.
      updateRule: 'id = @request.auth.id',
      deleteRule: 'id = @request.auth.id',
    });
  });

  it('uses any-of (?=) at the back-relation hops', () => {
    // WorkspaceMembers has no SINGLE-column unique index on either relation column,
    // so PocketBase enables its multi-match subquery. A plain `=` here would mean
    // "EVERY membership reachable from this user is mine" and would hide co-members
    // from anyone in more than one workspace.
    expect(usersCollectionPermissions.listRule).toContain('?=');
    expect(usersCollectionPermissions.listRule).not.toMatch(
      /[^?]= @request\.auth\.id$/
    );
  });
});

describe('membershipCollectionPermissions', () => {
  it('locks update to superusers', () => {
    // A membership row is two relation fields; add is a create, remove is a delete.
    // PocketBase evaluates an update rule only against the PRE-update record, so an
    // open updateRule let a member PATCH their own row's WorkspaceRef and join any
    // workspace whose id they knew.
    expect(membershipCollectionPermissions.updateRule).toBeNull();
  });

  it('keeps the remaining rules workspace-scoped', () => {
    expect(membershipCollectionPermissions).toEqual({
      listRule: memberRule('WorkspaceRef'),
      viewRule: memberRule('WorkspaceRef'),
      createRule: memberCreateRule('WorkspaceRef'),
      updateRule: null,
      deleteRule: memberRule('WorkspaceRef'),
    });
  });
});

/**
 * `defineCollection` stores its config as JSON on the Zod schema's description, and
 * that is the object the migration generator diffs against the database. Asserting
 * against it — rather than re-reading the constants — is what proves the schema files
 * actually consume them.
 */
describe('schema files consume the permission constants', () => {
  function collectionConfig(collection: { description?: string }) {
    return JSON.parse(collection.description ?? '{}');
  }

  it('Users', () => {
    expect(collectionConfig(UserCollection).permissions).toEqual(
      usersCollectionPermissions
    );
  });

  it('WorkspaceMembers', () => {
    expect(collectionConfig(WorkspaceMemberCollection).permissions).toEqual(
      membershipCollectionPermissions
    );
  });

  it('Workspaces constants are untouched by the Users widening', () => {
    expect(workspacesCollectionPermissions).toEqual({
      listRule: memberRule(''),
      viewRule: memberRule(''),
      createRule: AUTHENTICATED,
      updateRule: memberRule(''),
      deleteRule: memberRule(''),
    });
  });

  it('declares the WorkspaceMembers indexes byte-for-byte', () => {
    // The generator's compareIndexes is exact string equality against these, so a
    // whitespace or backtick difference from
    // pb/pb_migrations/1785361300_workspace_members_indexes.js makes the next
    // `yarn db:migrate` propose dropping them.
    //
    // Both are COMPOSITE on purpose: dbutils.FindSingleColumnUniqueIndex only
    // matches one-column unique indexes, and a match there would disable
    // PocketBase's multi-match resolution and change what `?=` means across the
    // whole schema.
    expect(collectionConfig(WorkspaceMemberCollection).indexes).toEqual([
      'CREATE UNIQUE INDEX idx_workspace_members_ws_user ON WorkspaceMembers (WorkspaceRef, UserRef)',
      'CREATE INDEX idx_workspace_members_user_ws ON WorkspaceMembers (UserRef, WorkspaceRef)',
    ]);
  });
});
