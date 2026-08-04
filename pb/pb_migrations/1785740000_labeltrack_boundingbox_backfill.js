/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// LabelTrack: backfill boundingBox — the union of a track's keyframe boxes.
//
// The column was added in 1768291979 with exactly this purpose ("allows you to
// spatially search without parsing the huge keyframes JSON") and then never
// written by anything: every row in every database has it empty. Meanwhile
// `keyframes` is capped at 10MB per row, so "which tracks are in the top-right
// quadrant" had no cheap answer at all — the only way to get a track's
// footprint was to download its whole path.
//
// The normalizers now compute it on the write side, and the step processors
// fill it in on already-persisted rows they re-encounter. Neither helps a row
// whose media is never re-run, which is what this migration is for.
//
// One static statement rather than a record loop: this touches every LabelTrack
// in the database, and a loop would read each 10MB keyframes payload into JS.
// SQLite's json_each does the aggregation in place.
//
// Idempotent and re-runnable: scoped to rows with an empty box, so a second run
// is a no-op, and rows the new normalizer already populated are left alone.
// ---------------------------------------------------------------------------

migrate((app) => {
  // Never throw: a failed boot migration rolls back startup and PocketBase
  // never opens its port. An unbackfilled row still works — every reader
  // derives the union from keyframes when the column is empty — so a failure
  // here costs some efficiency, not correctness.
  try {
    app.db().newQuery(`
      UPDATE LabelTrack
         SET boundingBox = (
               SELECT json_object(
                        'left',   MIN(json_extract(kf.value, '$.bbox.left')),
                        'top',    MIN(json_extract(kf.value, '$.bbox.top')),
                        'right',  MAX(json_extract(kf.value, '$.bbox.right')),
                        'bottom', MAX(json_extract(kf.value, '$.bbox.bottom'))
                      )
                 FROM json_each(LabelTrack.keyframes) AS kf
                WHERE json_extract(kf.value, '$.bbox.left') IS NOT NULL
             )
       WHERE COALESCE(boundingBox, '') IN ('', 'null')
         AND json_valid(keyframes)
         AND json_array_length(keyframes) > 0
         AND EXISTS (
               SELECT 1
                 FROM json_each(LabelTrack.keyframes) AS kf
                WHERE json_extract(kf.value, '$.bbox.left') IS NOT NULL
             )
    `).execute();
  } catch (err) {
    console.log("LabelTrack.boundingBox backfill failed (non-fatal): " + err);
  }

  // Speech and speaker tracks write `keyframes: []` by design and are left
  // untouched by all three guards above — an empty box on those rows is the
  // correct state, not a gap.

  return null;
}, (app) => {
  // Deliberately not reversed. This migration adds no schema, only derived
  // values, and by the time anyone rolls back, the normalizers have written
  // boxes of their own — clearing the column would throw those away to undo
  // something that was never destructive.
  void app;

  return null;
});
