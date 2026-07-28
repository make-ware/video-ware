/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Captions: enforce a minimum length of 1 on `text`.
//
// `text` is the full/fallback string shown when no cue is active, so a caption
// with an empty body renders as nothing at all. CaptionSchema has always
// declared TextField({ min: 1 }) and CaptionInputSchema rejects '' , but the
// collection was created with min: 0 — the constraint lived only in Zod, so a
// superuser write (the worker, a PB hook, the admin UI) could store a blank.
//
// `required` is already true, which rejects '' on its own; min: 1 makes the
// intent explicit and keeps the DB in step with the schema.
// ---------------------------------------------------------------------------
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("Captions");

    const text = collection.fields.getByName("text");
    text.min = 1;

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("Captions");

    const text = collection.fields.getByName("text");
    text.min = 0;

    return app.save(collection);
  }
);
