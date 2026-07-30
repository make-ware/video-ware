/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Audio waveforms: a new derived asset produced by the transcode flow.
//
// Two changes, both additive:
//   1. Files.fileType gains "waveform". PocketBase rejects an insert carrying a
//      select value that isn't listed, so the worker cannot write a waveform
//      File until this lands.
//   2. Media gains waveformFileRefs — the ordered set of waveform PNGs for a
//      media, mirroring filmstripFileRefs. A multi-relation because the audio
//      is chunked: one image per ~1000 seconds keeps the drawing readable
//      (see shared/src/utils/waveform.ts), so an hour of audio is four files.
//
// cascadeDelete is false to match every other Media -> Files relation: the
// cascade runs the other way, from Files.MediaRef, so deleting a Media removes
// its waveform File records (and the cleanup task reaps the blobs).
//
// No backfill: existing media get waveforms when they are re-ingested.
// ---------------------------------------------------------------------------

// Every FileType value (shared/src/enums.ts), with "waveform" appended.
const FILE_TYPE_VALUES = [
  "original",
  "proxy",
  "audio",
  "thumbnail",
  "sprite",
  "labels_json",
  "render",
  "filmstrip",
  "waveform",
];

migrate(
  (app) => {
    const files = app.findCollectionByNameOrId("Files");
    files.fields.getByName("fileType").values = FILE_TYPE_VALUES;
    app.save(files);

    const media = app.findCollectionByNameOrId("Media");
    media.fields.add(
      new RelationField({
        name: "waveformFileRefs",
        required: false,
        collectionId: "pb_48ql3az7t9ok2mu", // Files
        maxSelect: 999,
        minSelect: 0,
        cascadeDelete: false,
      })
    );

    return app.save(media);
  },
  (app) => {
    const media = app.findCollectionByNameOrId("Media");
    media.fields.removeByName("waveformFileRefs");
    app.save(media);

    const files = app.findCollectionByNameOrId("Files");
    files.fields.getByName("fileType").values = FILE_TYPE_VALUES.filter(
      (value) => value !== "waveform"
    );

    return app.save(files);
  }
);
