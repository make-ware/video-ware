/// <reference path="../pb_data/types.d.ts" />

// ClipLabelSearch is a read-only VIEW collection that powers universal search
// in the timeline editor. It joins MediaClips to the label tables on MediaRef
// and a time-overlap predicate (label.start < clip.end && label.end >
// clip.start), so a row exists for every (clip, overlapping label) pair across
// objects / tags / transcripts. PocketBase builds and drops the underlying SQL
// view from `viewQuery` automatically. `end` is quoted because it is a SQLite
// keyword.
migrate(
  (app) => {
    const viewQuery = `
      SELECT (mc.id || ':obj:' || lo.id) AS id,
             mc.WorkspaceRef AS WorkspaceRef,
             mc.MediaRef AS MediaRef,
             mc.id AS ClipRef,
             mc.start AS clipStart,
             mc."end" AS clipEnd,
             'objects' AS category,
             lo.entity AS matchText,
             lo.confidence AS confidence
      FROM MediaClips mc
      JOIN LabelObjects lo
        ON lo.MediaRef = mc.MediaRef
       AND lo.start < mc."end" AND lo."end" > mc.start
      UNION ALL
      SELECT (mc.id || ':seg:' || sg.id),
             mc.WorkspaceRef, mc.MediaRef, mc.id, mc.start, mc."end",
             'tags', sg.entity, sg.confidence
      FROM MediaClips mc
      JOIN LabelSegments sg
        ON sg.MediaRef = mc.MediaRef
       AND sg.start < mc."end" AND sg."end" > mc.start
      UNION ALL
      SELECT (mc.id || ':spe:' || sp.id),
             mc.WorkspaceRef, mc.MediaRef, mc.id, mc.start, mc."end",
             'transcripts', sp.transcript, sp.confidence
      FROM MediaClips mc
      JOIN LabelSpeech sp
        ON sp.MediaRef = mc.MediaRef
       AND sp.start < mc."end" AND sp."end" > mc.start
    `;

    const collection = new Collection({
      id: 'pb_cliplabelsrch01',
      name: 'ClipLabelSearch',
      type: 'view',
      // Authenticated users can read; rows are still narrowed by WorkspaceRef
      // at query time in the app.
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: null,
      deleteRule: null,
      manageRule: null,
      viewQuery,
      fields: [
        {
          name: 'id',
          type: 'text',
          required: true,
          primaryKey: true,
          system: true,
          hidden: false,
          presentable: false,
          min: 0,
          max: 0,
          pattern: '',
        },
        {
          name: 'WorkspaceRef',
          type: 'relation',
          required: false,
          collectionId: 'pb_6znl9bq7apv0rcg',
          maxSelect: 1,
          minSelect: 0,
          cascadeDelete: false,
        },
        {
          name: 'MediaRef',
          type: 'relation',
          required: false,
          collectionId: 'pb_1q5cu7dybj36pxm',
          maxSelect: 1,
          minSelect: 0,
          cascadeDelete: false,
        },
        {
          name: 'ClipRef',
          type: 'relation',
          required: false,
          collectionId: 'pb_v0io398cfx6qzc3',
          maxSelect: 1,
          minSelect: 0,
          cascadeDelete: false,
        },
        {
          name: 'clipStart',
          type: 'number',
          required: false,
        },
        {
          name: 'clipEnd',
          type: 'number',
          required: false,
        },
        {
          name: 'category',
          type: 'text',
          required: false,
        },
        {
          name: 'matchText',
          type: 'text',
          required: false,
        },
        {
          name: 'confidence',
          type: 'number',
          required: false,
        },
      ],
      indexes: [],
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('ClipLabelSearch');
    return app.delete(collection);
  }
);
