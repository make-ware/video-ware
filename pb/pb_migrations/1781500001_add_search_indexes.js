/// <reference path="../pb_data/types.d.ts" />

// Performance indexes for the ClipLabelSearch view's underlying joins:
// - MediaClips(WorkspaceRef) narrows clips to the workspace before joining.
// - MediaClips(MediaRef) + label (MediaRef, start, end) speed the
//   media-scoped time-overlap join.
// `end` is a SQLite keyword, quoted with backticks (PocketBase's index style).
const INDEXES = [
  [
    'MediaClips',
    'CREATE INDEX `idx_mediaclips_workspace` ON `MediaClips` (`WorkspaceRef`)',
  ],
  [
    'MediaClips',
    'CREATE INDEX `idx_mediaclips_media` ON `MediaClips` (`MediaRef`)',
  ],
  [
    'LabelObjects',
    'CREATE INDEX `idx_label_object_media_range` ON `LabelObjects` (`MediaRef`, `start`, `end`)',
  ],
  [
    'LabelSegments',
    'CREATE INDEX `idx_label_segment_media_range` ON `LabelSegments` (`MediaRef`, `start`, `end`)',
  ],
  [
    'LabelSpeech',
    'CREATE INDEX `idx_label_speech_media_range` ON `LabelSpeech` (`MediaRef`, `start`, `end`)',
  ],
];

migrate(
  (app) => {
    for (const [name, ddl] of INDEXES) {
      const collection = app.findCollectionByNameOrId(name);
      if (!collection.indexes.includes(ddl)) {
        collection.indexes.push(ddl);
        app.save(collection);
      }
    }
  },
  (app) => {
    for (const [name, ddl] of INDEXES) {
      const collection = app.findCollectionByNameOrId(name);
      const i = collection.indexes.findIndex((idx) => idx === ddl);
      if (i !== -1) {
        collection.indexes.splice(i, 1);
        app.save(collection);
      }
    }
  }
);
