/// <reference path="../pb_data/types.d.ts" />

// ClipLabelSearch is a read-only VIEW collection that powers universal search
// in the timeline editor. It joins MediaClips to the label tables on MediaRef
// and a time-overlap predicate (label.start < clip.end && label.end >
// clip.start), so a row exists for every (clip, overlapping label) pair across
// objects / tags / transcripts.
//
// Notes:
// - The UNION is wrapped in a subquery so the top-level SELECT exposes only
//   clean aliased columns (PocketBase's view-query parser rejects a top-level
//   UNION).
// - The view returns only the matched clip id + match metadata; the app
//   hydrates clip/media/thumbnail through the real MediaClips collection, so we
//   don't rely on relation expand working through a view.
// - `end` is quoted because it is a SQLite keyword.
migrate(
  (app) => {
    const viewQuery = `
      SELECT t.id AS id,
             t.WorkspaceRef AS WorkspaceRef,
             t.clipId AS clipId,
             t.category AS category,
             t.matchText AS matchText,
             t.confidence AS confidence
      FROM (
        SELECT (mc.id || ':obj:' || lo.id) AS id,
               mc.WorkspaceRef AS WorkspaceRef,
               mc.id AS clipId,
               'objects' AS category,
               lo.entity AS matchText,
               lo.confidence AS confidence
        FROM MediaClips mc
        JOIN LabelObjects lo
          ON lo.MediaRef = mc.MediaRef
         AND lo.start < mc."end" AND lo."end" > mc.start
        UNION ALL
        SELECT (mc.id || ':seg:' || sg.id),
               mc.WorkspaceRef, mc.id, 'tags', sg.entity, sg.confidence
        FROM MediaClips mc
        JOIN LabelSegments sg
          ON sg.MediaRef = mc.MediaRef
         AND sg.start < mc."end" AND sg."end" > mc.start
        UNION ALL
        SELECT (mc.id || ':spe:' || sp.id),
               mc.WorkspaceRef, mc.id, 'transcripts', sp.transcript, sp.confidence
        FROM MediaClips mc
        JOIN LabelSpeech sp
          ON sp.MediaRef = mc.MediaRef
         AND sp.start < mc."end" AND sp."end" > mc.start
      ) t
    `;

    const collection = new Collection({
      id: 'pb_cliplabelsrch01',
      name: 'ClipLabelSearch',
      type: 'view',
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: null,
      deleteRule: null,
      manageRule: null,
      viewQuery,
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('ClipLabelSearch');
    return app.delete(collection);
  }
);
