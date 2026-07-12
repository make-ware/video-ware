/// <reference path="../pb_data/types.d.ts" />
// ---------------------------------------------------------------------------
// Production hardening: scope every collection's API rules to workspace
// membership.
//
// Until now every workspace-owned collection shipped with the placeholder rule
// `@request.auth.id != ""` on all five actions, so ANY authenticated user could
// list/read/write EVERY other tenant's data. This migration replaces those with
// membership checks driven by the WorkspaceMembers back-relation:
//
//   <chain>.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id
//
// where <chain> is the relation path from the record to its Workspaces record.
// The worker authenticates as a PocketBase superuser and bypasses all rules, so
// background processing is unaffected; only the webapp and CLI (regular user
// auth) are constrained.
//
// Kept in sync with shared/src/utils/collection-permissions.ts (the source of
// truth consumed by pocketbase-migrate). Users stays as-is (`id =
// @request.auth.id`, already correct) and is intentionally not touched here.
// ---------------------------------------------------------------------------
migrate(
  (app) => {
    const AUTH = '@request.auth.id != ""';

    const memberDirect =
      'WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id';
    const createDirect =
      AUTH +
      ' && @request.body.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id';

    const memberTimeline =
      'TimelineRef.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id';
    const createTimeline =
      AUTH +
      ' && @request.body.TimelineRef.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id';

    const memberMedia =
      'MediaRef.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id';
    const createMedia =
      AUTH +
      ' && @request.body.MediaRef.WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id';

    const memberWorkspace =
      'WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id';

    const artifactRead =
      AUTH +
      ' && (WorkspaceRef = "" || WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id)';

    // Explicit per-collection application (no iteration over a collection list;
    // each call below is a static statement).
    const set = (name, list, view, create, update, del) => {
      const c = app.findCollectionByNameOrId(name);
      c.listRule = list;
      c.viewRule = view;
      c.createRule = create;
      c.updateRule = update;
      c.deleteRule = del;
      app.save(c);
    };

    // --- Direct WorkspaceRef ------------------------------------------------
    set('Captions', memberDirect, memberDirect, createDirect, memberDirect, memberDirect);
    set('Directories', memberDirect, memberDirect, createDirect, memberDirect, memberDirect);
    set('Entities', memberDirect, memberDirect, createDirect, memberDirect, memberDirect);
    set('Files', memberDirect, memberDirect, createDirect, memberDirect, memberDirect);
    set('LabelEntity', memberDirect, memberDirect, createDirect, memberDirect, memberDirect);
    set('LabelFaces', memberDirect, memberDirect, createDirect, memberDirect, memberDirect);
    set('LabelObjects', memberDirect, memberDirect, createDirect, memberDirect, memberDirect);
    set('LabelPerson', memberDirect, memberDirect, createDirect, memberDirect, memberDirect);
    set('LabelSegments', memberDirect, memberDirect, createDirect, memberDirect, memberDirect);
    set('LabelShots', memberDirect, memberDirect, createDirect, memberDirect, memberDirect);
    set('LabelSpeaker', memberDirect, memberDirect, createDirect, memberDirect, memberDirect);
    set('LabelSpeech', memberDirect, memberDirect, createDirect, memberDirect, memberDirect);
    set('LabelText', memberDirect, memberDirect, createDirect, memberDirect, memberDirect);
    set('LabelTrack', memberDirect, memberDirect, createDirect, memberDirect, memberDirect);
    set('Media', memberDirect, memberDirect, createDirect, memberDirect, memberDirect);
    set('MediaClipLabels', memberDirect, memberDirect, createDirect, memberDirect, memberDirect);
    set('MediaClips', memberDirect, memberDirect, createDirect, memberDirect, memberDirect);
    set('MediaRecommendations', memberDirect, memberDirect, createDirect, memberDirect, memberDirect);
    set('Tasks', memberDirect, memberDirect, createDirect, memberDirect, memberDirect);
    set('TimelineRecommendations', memberDirect, memberDirect, createDirect, memberDirect, memberDirect);
    set('TimelineRenders', memberDirect, memberDirect, createDirect, memberDirect, memberDirect);
    set('Timelines', memberDirect, memberDirect, createDirect, memberDirect, memberDirect);
    set('Uploads', memberDirect, memberDirect, createDirect, memberDirect, memberDirect);
    set('UsageEvents', memberDirect, memberDirect, createDirect, memberDirect, memberDirect);
    // WorkspaceMembers: list/view = co-members of your workspaces; create =
    // existing members only (the creator's first membership is added by the
    // hook-workspaces-create / hook-users-create superuser hooks).
    set('WorkspaceMembers', memberDirect, memberDirect, createDirect, memberDirect, memberDirect);

    // --- Nested via a timeline ---------------------------------------------
    set('TimelineClips', memberTimeline, memberTimeline, createTimeline, memberTimeline, memberTimeline);
    set('TimelineTracks', memberTimeline, memberTimeline, createTimeline, memberTimeline, memberTimeline);

    // --- Scoped via media (LabelJobs has no WorkspaceRef) ------------------
    set('LabelJobs', memberMedia, memberMedia, createMedia, memberMedia, memberMedia);

    // --- The Workspaces collection itself ----------------------------------
    // Any authenticated user may create; membership is added server-side right
    // after (hook), which is why create stays `AUTH` rather than member-gated.
    set('Workspaces', memberWorkspace, memberWorkspace, AUTH, memberWorkspace, memberWorkspace);

    // --- Superuser-written, workspace-scoped reads -------------------------
    // Artifacts: worker/hooks own writes (null => superuser only); workspace-less
    // system rows remain readable to any authed user.
    set('Artifacts', artifactRead, artifactRead, null, null, null);

    // ClipLabelSearch is a VIEW (read-only; create/update/delete are inherently
    // null). Scope its reads to workspace membership like the base collections.
    set('ClipLabelSearch', memberDirect, memberDirect, null, null, null);
  },
  (app) => {
    // Down: restore the original permissive placeholder rules.
    const AUTH = '@request.auth.id != ""';
    const set = (name, list, view, create, update, del) => {
      const c = app.findCollectionByNameOrId(name);
      c.listRule = list;
      c.viewRule = view;
      c.createRule = create;
      c.updateRule = update;
      c.deleteRule = del;
      app.save(c);
    };

    set('Captions', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('Directories', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('Entities', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('Files', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('LabelEntity', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('LabelFaces', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('LabelObjects', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('LabelPerson', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('LabelSegments', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('LabelShots', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('LabelSpeaker', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('LabelSpeech', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('LabelText', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('LabelTrack', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('Media', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('MediaClipLabels', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('MediaClips', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('MediaRecommendations', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('Tasks', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('TimelineRecommendations', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('TimelineRenders', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('Timelines', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('Uploads', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('UsageEvents', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('WorkspaceMembers', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('TimelineClips', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('TimelineTracks', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('LabelJobs', AUTH, AUTH, AUTH, AUTH, AUTH);
    set('Workspaces', AUTH, AUTH, AUTH, AUTH, AUTH);
    // Artifacts / ClipLabelSearch: writes were superuser-only (null) before.
    set('Artifacts', AUTH, AUTH, null, null, null);
    set('ClipLabelSearch', AUTH, AUTH, null, null, null);
  }
);
