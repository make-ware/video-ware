/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Users: co-members can read each other, and emails become visible.
//
// Rules mirror shared/src/utils/collection-permissions.ts
// (`usersCollectionPermissions`) — the source of truth. Keep them in step.
//
// BEFORE: list/viewRule = `id = @request.auth.id`. A user could read only
// themselves, so the workspace member list had nothing to show: PocketBase filters
// expanded relation records through the target collection's viewRule
// (apis.expandFetch), so `WorkspaceMembers?expand=UserRef` resolved every row but
// the caller's own to nothing, and the members page silently dropped them.
//
// AFTER: also readable if you share at least one workspace. The chain is the
// mirror image of memberRule() — out of the user through the UserRef
// back-relation to their memberships, to each of those workspaces, then back in
// through that workspace's members looking for the caller. 4 props / 3 joins;
// PocketBase's limit is 6 (core maxNestedRels).
//
// `?=` at both back-relation hops is load-bearing: WorkspaceMembers has no
// SINGLE-column unique index on either relation column, so PocketBase enables its
// multi-match subquery and the un-prefixed `=` would mean "EVERY membership
// reachable from this user is mine". The composite unique index added in
// 1785361300 is two columns and does not disturb that.
//
// Writes are NOT widened. createRule stays "" (open signup), update/delete stay
// `id = @request.auth.id`. Reading a co-member never implies editing them.
// `password` and `tokenKey` stay hidden system fields: neither serialized nor
// filterable for a non-superuser.
//
// emailVisibility: the rule alone is not enough. PocketBase masks `email` during
// serialization unless emailVisibility is true, the requester owns the record, or
// the requester is a superuser (core.Record.PublicExport /
// apis.autoResolveRecordsFlags) — and expanded records go through the same path,
// so `member.expand.UserRef.email` would come back blank. Existing rows are
// backfilled here; new records are handled by
// pb_hooks/hook-users-email-visibility.pb.js, which covers every create path
// including OAuth2 and a client that submits `emailVisibility: false`.
//
// Raw SQL, one statement, no record loop: this touches every user in the database
// and needs to be atomic with the rule change. It deliberately does NOT bump
// `updated` — a raw query bypasses the record layer, which is what we want, since
// the flag is a schema-semantics correction rather than a profile edit and bumping
// it would invalidate the optimistic-concurrency guards in
// BaseMutator.updateWithGuard for any in-flight client.
//
// FAILURE POLICY: no try/catch (unlike the Media.name backfill in
// 1785196800_updated_Media_name.js, where an unbackfilled row degraded to a slower
// lookup). Here the backfill IS half the migration — widened rules with masked
// emails is a half-shipped feature with no runtime fallback. PocketBase runs each
// migration in a transaction, so a throw rolls the rule change back too and leaves
// a consistent old state.
//
// The down migration reverts the rules but LEAVES emailVisibility ALONE. There is
// no record of each row's prior value, and resetting to false would destroy a flag
// a user set deliberately. With the rules reverted the field is unreachable by
// anyone but the owner and superusers, so leaving it true leaks nothing.
// ---------------------------------------------------------------------------

const CO_MEMBER_READ_RULE =
  'id = @request.auth.id || WorkspaceMembers_via_UserRef.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id';

migrate((app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_");

  // update collection data
  unmarshal({
    "listRule": CO_MEMBER_READ_RULE,
    "viewRule": CO_MEMBER_READ_RULE
  }, collection);

  app.save(collection);

  // Backfill. `TRUE` is the integer 1 in SQLite, matching what PocketBase's dbx
  // binds a Go bool to and the column's own `DEFAULT FALSE` idiom. `IS NOT TRUE`
  // keeps the statement idempotent and covers a stray NULL.
  app.db().newQuery(`
    UPDATE users
       SET emailVisibility = TRUE
     WHERE emailVisibility IS NOT TRUE
  `).execute();

  return null;
}, (app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_");

  // update collection data
  unmarshal({
    "listRule": "id = @request.auth.id",
    "viewRule": "id = @request.auth.id"
  }, collection);

  // emailVisibility is intentionally left as-is — see the header.
  return app.save(collection);
});
