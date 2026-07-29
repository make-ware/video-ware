/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Users -> emailVisibility = true on create
//
// Co-members identify each other by name + email
// (1785361310_widen_Users_read_to_comembers.js widens Users list/viewRule to
// anyone sharing a workspace). The rule alone is not enough: PocketBase masks the
// `email` field during serialization unless emailVisibility is true, the requester
// owns the record, or the requester is a superuser (core.Record.PublicExport /
// apis.autoResolveRecordsFlags). Expanded records go through the same path, so
// without this every co-member row would render a blank email.
//
// The MODEL-level create hook, not onRecordCreateRequest. Both cover the two API
// signup paths — OAuth2 signup goes through an internal
// POST /api/collections/Users/records (apis.sendOAuth2RecordCreateRequest), so the
// request hook would fire for it too — but onRecordCreate additionally covers
// programmatic $app.save() creates (imports, the superuser CLI, future hooks) with
// less code and no requestInfo() juggling.
//
// It also overrides a client that submits `emailVisibility: false`: createRule is
// "" (open signup) and forms.RecordUpsert gates only `email` and `verified` behind
// manage access, so the field IS client-settable.
//
// Create only, deliberately. updateRule is `id = @request.auth.id` and the field is
// not manager-gated, so a user can still opt back out from their own profile;
// forcing it on every update would take that away.
//
// Self-contained: all logic lives inside the handler (pb_hooks run in isolated
// pooled runtimes with no shared top-level scope).
// ---------------------------------------------------------------------------
onRecordCreate((e) => {
  e.record.set('emailVisibility', true);
  e.next();
}, 'Users');
