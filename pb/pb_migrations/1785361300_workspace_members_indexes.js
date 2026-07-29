/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// WorkspaceMembers: index the join table, and make (WorkspaceRef, UserRef) unique.
//
// Mirrors the `indexes` array in shared/src/schema/workspace-member.ts. The
// generator compares index strings for EXACT equality, so the two must stay
// byte-identical or the next `yarn db:migrate` proposes dropping them.
//
// This table had ZERO indexes while being the join point of every
// workspace-scoped API rule in the database
// (`<chain>.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id`).
// The next migration adds a second, REVERSE traversal for the Users read rule,
// which turns every Users list/view/expand into a three-way correlated join
// through here — so index both orderings of the pair first, in its own migration,
// so it lands before the rule that depends on it.
//
// (WorkspaceRef, UserRef) serves getMembersByWorkspace, getByUserAndWorkspace,
// both bootstrap hooks, the worker's oldest-member lookup and the new add-member
// endpoint. (UserRef, WorkspaceRef) serves getMembershipsByUser and the webapp's
// workspace switcher. The middle hop lands on Workspaces.id (the PK) — nothing
// needed there.
//
// TWO COLUMNS ON THE UNIQUE INDEX ON PURPOSE. PocketBase's field resolver calls
// dbutils.FindSingleColumnUniqueIndex(collection.Indexes, relFieldName) when it
// walks a *_via_* back-relation, and a hit there disables the multi-match
// subquery — which silently turns `?=` (any of) into a plain equality against a
// single joined row. A composite index is not a single-column index, so the
// semantics of every existing rule are untouched. NEVER add a single-column
// unique index on WorkspaceRef or UserRef.
//
// DEDUPE FIRST, AND IT IS DESTRUCTIVE. Nothing but application-level guards has
// ever prevented duplicate membership rows (WorkspaceService.addMember and the two
// bootstrap hooks). If a database has them, building the unique index fails, this
// migration throws, and PocketBase never opens its port — so duplicates are
// collapsed inline, in the same transaction, before the index. Migrations run at
// boot before the HTTP listener, so nothing can insert a duplicate in between.
//
// The surviving row is the EARLIEST by (created, id). That is not arbitrary:
// worker/src/watch-folder/watch-folder.service.ts picks a workspace's oldest
// membership as the acting user for imported files, so keeping the newest would
// silently re-attribute every watch-folder import.
//
// The down migration drops the indexes. It CANNOT bring the deleted rows back.
// That is acceptable only because a duplicate row carries no information beyond
// the (WorkspaceRef, UserRef) pair the survivor already has — the only columns
// lost are the id/created/updated of a redundant row. Back up pb_data/data.db
// before the first boot anyway.
//
// FAILURE POLICY: no try/catch, unlike the Media.name backfill in
// 1785196800_updated_Media_name.js, where an unbackfilled row degraded to a
// slower lookup and an unbootable server was the worse outcome. Here there is no
// runtime fallback: a silently-skipped unique index leaves the database out of
// sync with the schema file and makes the next `yarn db:migrate` churn. A throw
// rolls the whole migration back and leaves it unrecorded — loud and repeatable.
// ---------------------------------------------------------------------------

const WS_USER_UNIQUE_INDEX =
  "CREATE UNIQUE INDEX idx_workspace_members_ws_user ON WorkspaceMembers (WorkspaceRef, UserRef)";
const USER_WS_INDEX =
  "CREATE INDEX idx_workspace_members_user_ws ON WorkspaceMembers (UserRef, WorkspaceRef)";

migrate((app) => {
  // Collapse duplicate (WorkspaceRef, UserRef) pairs onto their earliest row. One
  // static statement rather than a record loop: this reads every membership in the
  // database and must be atomic with the index build below.
  app.db().newQuery(`
    DELETE FROM WorkspaceMembers
     WHERE id NOT IN (
       SELECT id FROM (
         SELECT id,
                ROW_NUMBER() OVER (
                  PARTITION BY WorkspaceRef, UserRef
                  ORDER BY created ASC, id ASC
                ) AS rn
           FROM WorkspaceMembers
       ) WHERE rn = 1
     )
  `).execute();

  const collection = app.findCollectionByNameOrId("pb_cg58dy19tzyzwb1");

  collection.indexes = collection.indexes
    .filter((idx) => idx !== WS_USER_UNIQUE_INDEX && idx !== USER_WS_INDEX)
    .concat([WS_USER_UNIQUE_INDEX, USER_WS_INDEX]);

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pb_cg58dy19tzyzwb1");

  // Only the indexes come back. The deduped rows do not — see the header.
  collection.indexes = collection.indexes.filter(
    (idx) => idx !== WS_USER_UNIQUE_INDEX && idx !== USER_WS_INDEX
  );

  return app.save(collection);
});
