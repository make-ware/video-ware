/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Media: add cropSuggestion — the last ffmpeg `cropdetect` recommendation from
// the ingest AUTOCROP step. Written on every detection, applied or not, so the
// column explains what `Media.crop` holds and why: it carries the recommended
// rect (display-frame fractions, same space as `crop`), the raw pixel window,
// how many sample windows produced it, whether it was applied, and the skip
// reason when it was not.
//
// It is also what makes re-ingest safe: the step only overwrites a `crop` it
// still owns (one matching the previously applied suggestion), so a human's
// framing is never silently replaced.
//
// Left bare (no DB-side constraints), matching the `crop` column: shape is
// enforced by CropSuggestionSchema at the app layer (shared/src/types/crop.ts).
//
// No backfill: an empty JSON column reads as null, which is exactly "never
// detected". Existing media pick a suggestion up on their next ingest.
// ---------------------------------------------------------------------------
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("Media");

    collection.fields.add(
      new JSONField({
        name: "cropSuggestion",
        required: false,
      })
    );

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("Media");

    collection.fields.removeByName("cropSuggestion");

    return app.save(collection);
  }
);
