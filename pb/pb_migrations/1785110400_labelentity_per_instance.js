/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// LabelEntity becomes the per-media, per-instance link point.
//
// Before: one LabelEntity per (workspace, labelType, canonicalName, provider),
// with no media in the key. A single "Speaker 1" row was therefore shared by
// every media in the workspace — linking it to a person in one video silently
// claimed every other video's first speaker. Already observable before this
// migration: the speech entity "Track 0" spanned two unrelated videos.
//
// After: one LabelEntity per detected instance per media — one per LabelTrack,
// plus one per LabelShots/LabelSegments row (those two collections have no
// LabelTrackRef at all), plus one per trackless leaf row (step 6). LabelEntity
// carries EntityRef and is the only link point; LabelTrack keeps the heavy
// payload (keyframes, boundingBox, trackData) and stops being an identity
// holder.
//
// The crux is step 1: the OLD two-level precedence rule (track link wins, the
// cluster link is the fallback) is resolved ONCE HERE, into data —
//   EntityRef = COALESCE(NULLIF(track.EntityRef,''), cluster.EntityRef)
// so every manual "this track is Erik" survives with the same meaning, and the
// runtime rule can be deleted from the eight places it was written.
//
// LabelTrack.EntityRef is deliberately LEFT IN PLACE AND POPULATED as a
// recovery net. No application code reads it once this migration lands —
// verified across cli/, webapp/, worker/, shared/ and the two views rewritten
// in the sibling migrations (1785110401, 1785110402), all of which resolve
// attribution through LabelEntityRef.EntityRef. Dropping the column is a
// separate, later migration once this model has run in anger.
//
// FAILURE POLICY — deliberately the opposite of the LabelTrack.labelType
// backfill next door. There, an unbackfilled row degraded to a slower lookup,
// so swallowing the error and booting was the right call. Here the backfill IS
// the migration: the new readers resolve attribution only through
// LabelEntity.EntityRef, so a backfill that half-ran leaves manual entity
// links invisible — and because PocketBase records the migration as applied
// either way, re-running to repair them is impossible. So every statement
// rethrows with the step that failed. A throw rolls the whole migration back
// (PocketBase runs each migration in a transaction), leaves it unrecorded, and
// stops the server with the reason — loud and repeatable, which beats silently
// losing every "this speaker is Erik" in the database.
//
// Every data statement is idempotent (INSERT OR IGNORE against the unique
// entityHash index, plus a `legacy row` guard of MediaRef = '') so a rerun
// after a fix picks up exactly what the failed run left behind.
//
// Rollback honesty: the down migration restores the collapsed cluster rows and
// repoints refs at them, but it CANNOT reproduce the original entityHash
// values — those were SHA-256 digests and SQLite has no SHA-256. Rolling back
// leaves structurally-correct clusters with plain-text keys. For exact
// fidelity, restore the pb_data/data.db backup taken before running this.
// ---------------------------------------------------------------------------

const MEDIA_TYPE_INDEX =
  "CREATE INDEX idx_label_entity_media_type ON LabelEntity (MediaRef, labelType)";
const MEDIA_INSTANCE_INDEX =
  "CREATE INDEX idx_label_entity_media_instance ON LabelEntity (MediaRef, instanceId)";

// PocketBase's own id default, reused so migration-minted rows are
// indistinguishable from API-minted ones.
const NEW_ID = "'r'||lower(hex(randomblob(7)))";
const NOW = "strftime('%Y-%m-%d %H:%M:%f','now')||'Z'";

// The six leaf collections that reach their entity through a track, each with
// the expression that identifies ONE detected instance within a media — used
// only for rows that never got there through a track (step 6).
//
// LabelSpeaker and LabelSpeech carry the provider's own instance key, so their
// orphans regroup exactly as the normalizers would have grouped them:
// speakerId ("speaker_0") and the speaker tag rendered as a string, which is
// what speech-transcription.normalizer.ts uses as the trackId. The other four
// have no instance key on the row — a face/object/person/text row without a
// track has nothing to group with — so each becomes its own instance via its
// own unique hash. One entity per row is the honest answer there: it is
// per-media and per-instance by construction, which is the property this
// migration exists to establish.
const TRACKED_LEAVES = [
  { table: "LabelObjects", instance: (t) => `COALESCE(${t}.objectHash, '')` },
  { table: "LabelFaces", instance: (t) => `COALESCE(${t}.faceHash, '')` },
  { table: "LabelPerson", instance: (t) => `COALESCE(${t}.personHash, '')` },
  {
    table: "LabelSpeech",
    // Double CAST: the tag is a PocketBase number, so a REAL-affinity 0 would
    // render as "0.0" and miss the normalizer's "0".
    instance: (t) =>
      `CAST(CAST(COALESCE(${t}.speakerTag, 0) AS INTEGER) AS TEXT)`,
  },
  { table: "LabelSpeaker", instance: (t) => `COALESCE(${t}.speakerId, '')` },
  { table: "LabelText", instance: (t) => `COALESCE(${t}.textHash, '')` },
];

// The two collections whose rows ARE their own instance (no track, ever).
const CLUSTER_ONLY_LEAVES = [
  { table: "LabelShots", instance: (t) => `COALESCE(${t}.shotHash, '')` },
  { table: "LabelSegments", instance: (t) => `COALESCE(${t}.segmentHash, '')` },
];

const ALL_LEAVES = TRACKED_LEAVES.concat(CLUSTER_ONLY_LEAVES);

/**
 * Mint one per-instance LabelEntity for every leaf row still pointing at a
 * legacy workspace-wide cluster, deriving name/provider/processor/link from
 * that cluster so the row keeps its exact meaning.
 */
function mintFromLeaf(table, instanceExpr) {
  const inst = instanceExpr("x");
  return `
    INSERT OR IGNORE INTO LabelEntity
      (id, WorkspaceRef, MediaRef, labelType, canonicalName, provider,
       processor, instanceId, metadata, entityHash, EntityRef, created, updated)
    SELECT
      ${NEW_ID}, x.WorkspaceRef, x.MediaRef, le.labelType, le.canonicalName,
      le.provider, le.processor, ${inst}, le.metadata,
      x.WorkspaceRef || ':' || x.MediaRef || ':' || le.labelType || ':' ||
        ${inst} || ':' || le.provider,
      COALESCE(le.EntityRef, ''),
      ${NOW}, ${NOW}
    FROM ${table} x
    JOIN LabelEntity le ON le.id = x.LabelEntityRef
    WHERE COALESCE(le.MediaRef, '') = ''
      AND COALESCE(x.MediaRef, '') <> ''
      AND ${inst} <> ''
  `;
}

/**
 * Repoint a leaf collection from its legacy cluster onto the per-instance row
 * minted for it. Matching on (media, instance, labelType, provider) — provider
 * included so two providers' instances that happen to share an id within one
 * media can't cross-wire. Gated on the CURRENT ref being a legacy row, which
 * is what makes a rerun a no-op.
 */
function repointLeaf(table, instanceExpr) {
  const inst = instanceExpr(table);
  const match = `
       FROM LabelEntity ne
       JOIN LabelEntity le ON le.id = ${table}.LabelEntityRef
      WHERE COALESCE(le.MediaRef, '') = ''
        AND ne.MediaRef = ${table}.MediaRef
        AND COALESCE(ne.instanceId, '') = ${inst}
        AND ne.labelType = le.labelType
        AND ne.provider  = le.provider`;
  return `
    UPDATE ${table} SET LabelEntityRef = (SELECT ne.id ${match})
    WHERE EXISTS (SELECT 1 ${match})
  `;
}

migrate((app) => {
  const collection = app.findCollectionByNameOrId("LabelEntity");

  collection.fields.add(new RelationField({
    name: "MediaRef",
    // Optional so step 7's safety catch can leave an unresolvable legacy row
    // in place (still valid, still referenced) instead of dangling a ref. A
    // legacy row that carries a manual link is a different matter — step 8
    // fails the migration rather than let one hide.
    required: false,
    collectionId: "pb_1q5cu7dybj36pxm", // Media
    maxSelect: 1,
    minSelect: 0,
    cascadeDelete: true, // an entity describes one media; it dies with it
  }));

  collection.fields.add(new TextField({
    name: "instanceId",
    required: false,
  }));

  collection.indexes = collection.indexes
    .filter((idx) => idx !== MEDIA_TYPE_INDEX && idx !== MEDIA_INSTANCE_INDEX)
    .concat([MEDIA_TYPE_INDEX, MEDIA_INSTANCE_INDEX]);

  // Columns must exist before any of the SQL below runs.
  app.save(collection);

  const steps = [];

  // --- Step 1: one LabelEntity per LabelTrack -------------------------------
  // Derives only from legacy cluster rows (MediaRef = ''), which is what makes
  // a rerun a no-op: after step 2 the tracks point at media-scoped rows and
  // this join finds nothing.
  steps.push(["1 mint per-track entities", `
    INSERT OR IGNORE INTO LabelEntity
      (id, WorkspaceRef, MediaRef, labelType, canonicalName, provider,
       processor, instanceId, metadata, entityHash, EntityRef, created, updated)
    SELECT
      ${NEW_ID},
      lt.WorkspaceRef,
      lt.MediaRef,
      COALESCE(NULLIF(lt.labelType, ''), le.labelType),
      le.canonicalName,
      le.provider,
      le.processor,
      COALESCE(lt.trackId, ''),
      le.metadata,
      lt.WorkspaceRef || ':' || lt.MediaRef || ':' ||
        COALESCE(NULLIF(lt.labelType, ''), le.labelType) || ':' ||
        COALESCE(lt.trackId, '') || ':' || le.provider,
      COALESCE(NULLIF(lt.EntityRef, ''), le.EntityRef, ''),
      ${NOW}, ${NOW}
    FROM LabelTrack lt
    JOIN LabelEntity le ON le.id = lt.LabelEntityRef
    WHERE COALESCE(le.MediaRef, '') = ''
      -- never mint another media-less row; that is the shape being retired
      AND COALESCE(lt.MediaRef, '') <> ''
  `]);

  // --- Step 2: repoint LabelTrack at its own entity -------------------------
  // Matched through the track's CURRENT (legacy) cluster rather than on
  // LabelTrack.labelType alone: that column is a backfilled denormalization
  // and is legitimately '' for tracks the previous migration could not derive
  // one for, in which case step 1 took the type from the cluster and a
  // labelType-equality match would find nothing — silently leaving the track,
  // and every leaf row hanging off it, on the workspace-wide cluster.
  steps.push(["2 repoint LabelTrack", `
    UPDATE LabelTrack SET LabelEntityRef = (
      SELECT ne.id
        FROM LabelEntity ne
        JOIN LabelEntity le ON le.id = LabelTrack.LabelEntityRef
       WHERE COALESCE(le.MediaRef, '') = ''
         AND ne.MediaRef = LabelTrack.MediaRef
         AND COALESCE(ne.instanceId, '') = COALESCE(LabelTrack.trackId, '')
         AND ne.labelType = COALESCE(NULLIF(LabelTrack.labelType, ''), le.labelType)
         AND ne.provider  = le.provider
    )
    WHERE EXISTS (
      SELECT 1
        FROM LabelEntity ne
        JOIN LabelEntity le ON le.id = LabelTrack.LabelEntityRef
       WHERE COALESCE(le.MediaRef, '') = ''
         AND ne.MediaRef = LabelTrack.MediaRef
         AND COALESCE(ne.instanceId, '') = COALESCE(LabelTrack.trackId, '')
         AND ne.labelType = COALESCE(NULLIF(LabelTrack.labelType, ''), le.labelType)
         AND ne.provider  = le.provider
    )
  `]);

  // --- Step 3: repair the denormalized LabelTrack.labelType -----------------
  // Free now that every track points at a typed per-instance row, and it
  // repairs tracks the previous migration's (deliberately non-fatal) backfill
  // left blank — those are the ones the speaker UI's typed lookup can't see.
  steps.push(["3 repair LabelTrack.labelType", `
    UPDATE LabelTrack
       SET labelType = (
             SELECT le.labelType FROM LabelEntity le
              WHERE le.id = LabelTrack.LabelEntityRef
           )
     WHERE COALESCE(labelType, '') = ''
       AND EXISTS (
             SELECT 1 FROM LabelEntity le
              WHERE le.id = LabelTrack.LabelEntityRef
                AND COALESCE(le.labelType, '') <> ''
           )
  `]);

  // --- Step 4: repoint the six tracked leaf collections ----------------------
  // Must follow step 2 — these read the track's freshly-repointed ref.
  for (const leaf of TRACKED_LEAVES) {
    steps.push([`4 repoint ${leaf.table} via track`, `
      UPDATE ${leaf.table} SET LabelEntityRef = (
        SELECT lt.LabelEntityRef FROM LabelTrack lt
         WHERE lt.id = ${leaf.table}.LabelTrackRef
      )
      WHERE COALESCE(${leaf.table}.LabelTrackRef, '') <> ''
        AND EXISTS (
          SELECT 1 FROM LabelTrack lt
           WHERE lt.id = ${leaf.table}.LabelTrackRef
             AND COALESCE(lt.LabelEntityRef, '') <> ''
        )
    `]);
  }

  // --- Step 5: shots and segments get a row per leaf row --------------------
  // instanceId is the row's own shotHash/segmentHash: these are classifications
  // with no provider track, so the row itself is the instance.
  for (const leaf of CLUSTER_ONLY_LEAVES) {
    steps.push([`5 mint ${leaf.table} entities`,
      mintFromLeaf(leaf.table, leaf.instance)]);
    steps.push([`5 repoint ${leaf.table}`,
      repointLeaf(leaf.table, leaf.instance)]);
  }

  // --- Step 6: leaf rows that never reached a per-instance row --------------
  // Step 4 only moves a leaf that has a LabelTrackRef whose track carries an
  // entity. Everything else is still on the shared workspace-wide cluster, and
  // that cluster is exactly the row the new UI writes EntityRef onto — so
  // leaving them there reproduces the cross-media bug this migration exists to
  // fix, on the very rows it was supposed to repair. Real populations here:
  // speech/speaker utterances whose track was dropped during a partial rerun
  // (see speech-transcription-step.processor.ts), and any leaf whose track was
  // itself underivable in step 1.
  //
  // Runs after step 4 so it only ever sees what the track path could not
  // resolve, and it is gated on the current ref still being a legacy row.
  for (const leaf of TRACKED_LEAVES) {
    steps.push([`6 mint ${leaf.table} orphan entities`,
      mintFromLeaf(leaf.table, leaf.instance)]);
    steps.push([`6 repoint ${leaf.table} orphans`,
      repointLeaf(leaf.table, leaf.instance)]);
  }

  // --- Step 7: drop legacy cluster rows nothing points at any more ----------
  // The NOT EXISTS chain is the safety catch: a legacy row that somehow still
  // has a referrer survives (and MediaRef being optional keeps it valid)
  // rather than leaving a dangling ref behind. Step 8 then fails the migration
  // if any survivor still carries a manual link.
  steps.push(["7 drop orphaned legacy clusters", `
    DELETE FROM LabelEntity
     WHERE COALESCE(MediaRef, '') = ''
       AND NOT EXISTS (SELECT 1 FROM LabelTrack    x WHERE x.LabelEntityRef = LabelEntity.id)
       AND NOT EXISTS (SELECT 1 FROM LabelObjects  x WHERE x.LabelEntityRef = LabelEntity.id)
       AND NOT EXISTS (SELECT 1 FROM LabelFaces    x WHERE x.LabelEntityRef = LabelEntity.id)
       AND NOT EXISTS (SELECT 1 FROM LabelPerson   x WHERE x.LabelEntityRef = LabelEntity.id)
       AND NOT EXISTS (SELECT 1 FROM LabelSpeech   x WHERE x.LabelEntityRef = LabelEntity.id)
       AND NOT EXISTS (SELECT 1 FROM LabelSpeaker  x WHERE x.LabelEntityRef = LabelEntity.id)
       AND NOT EXISTS (SELECT 1 FROM LabelText     x WHERE x.LabelEntityRef = LabelEntity.id)
       AND NOT EXISTS (SELECT 1 FROM LabelShots    x WHERE x.LabelEntityRef = LabelEntity.id)
       AND NOT EXISTS (SELECT 1 FROM LabelSegments x WHERE x.LabelEntityRef = LabelEntity.id)
  `]);

  // --- Step 8: assert no manual link was left behind ------------------------
  // A surviving legacy row with an EntityRef is a "this speaker is Erik" that
  // the new readers can no longer see — the exact data loss this migration
  // must not cause. Nothing above can produce one (every referrer path mints a
  // per-instance row), so if it happens the derivation missed a case and the
  // right answer is to fail, fix it, and rerun rather than boot on top of it.
  //
  // Expressed as a CHECK constraint rather than by reading the count back into
  // JS: this needs nothing from the JSVM beyond newQuery().execute(), which is
  // the one database binding the migration guide documents. The column name is
  // the assertion, so it lands in the SQLite error verbatim.
  const CHECK_TABLE = "_labelentity_per_instance_check";
  steps.push([`8 prepare check`,
    `DROP TABLE IF EXISTS temp.${CHECK_TABLE}`]);
  steps.push([`8 prepare check table`, `
    CREATE TEMP TABLE ${CHECK_TABLE} (
      workspace_wide_LabelEntity_rows_still_carrying_a_manual_EntityRef
        INTEGER CHECK (
          workspace_wide_LabelEntity_rows_still_carrying_a_manual_EntityRef = 0
        )
    )
  `]);
  steps.push([
    "8 verify every manual entity link survived — if this failed, inspect: " +
      "SELECT * FROM LabelEntity WHERE COALESCE(MediaRef,'') = '' " +
      "AND COALESCE(EntityRef,'') <> ''",
    `
    INSERT INTO ${CHECK_TABLE}
    SELECT COUNT(*) FROM LabelEntity
     WHERE COALESCE(MediaRef, '') = ''
       AND COALESCE(EntityRef, '') <> ''
  `]);
  steps.push([`8 drop check table`, `DROP TABLE temp.${CHECK_TABLE}`]);

  for (const step of steps) {
    try {
      app.db().newQuery(step[1]).execute();
    } catch (err) {
      // Rethrow: see FAILURE POLICY above. The step name is the whole point —
      // it says which statement to fix before the next boot retries.
      throw new Error(
        "LabelEntity per-instance backfill failed at step " + step[0] +
        ": " + err
      );
    }
  }

  return null;
}, (app) => {
  // Reverse: collapse per-instance rows back into workspace-wide clusters.
  // entityHash cannot be restored to its original SHA-256 (no SQLite digest),
  // so restored clusters carry a plain composite key. LabelTrack.EntityRef was
  // never modified, so pre-migration track links are intact; links made after
  // the migration live on the per-instance rows and are folded back onto the
  // cluster below (MAX so a link wins over a blank) rather than dropped.
  try {
    app.db().newQuery(`
      INSERT OR IGNORE INTO LabelEntity
        (id, WorkspaceRef, MediaRef, labelType, canonicalName, provider,
         processor, instanceId, metadata, entityHash, EntityRef, created, updated)
      SELECT
        ${NEW_ID}, WorkspaceRef, '', labelType, canonicalName, provider,
        MIN(processor), '', NULL,
        WorkspaceRef || ':' || labelType || ':' || lower(trim(canonicalName)) ||
          ':' || provider,
        COALESCE(MAX(NULLIF(EntityRef, '')), ''), ${NOW}, ${NOW}
      FROM LabelEntity
      WHERE COALESCE(MediaRef, '') <> ''
      GROUP BY WorkspaceRef, labelType, canonicalName, provider
    `).execute();

    const repoint = (table) => `
      UPDATE ${table} SET LabelEntityRef = (
        SELECT old.id FROM LabelEntity old
          JOIN LabelEntity cur ON cur.id = ${table}.LabelEntityRef
         WHERE COALESCE(old.MediaRef, '') = ''
           AND old.WorkspaceRef  = cur.WorkspaceRef
           AND old.labelType     = cur.labelType
           AND old.canonicalName = cur.canonicalName
           AND old.provider      = cur.provider
      )
      WHERE EXISTS (
        SELECT 1 FROM LabelEntity cur
          JOIN LabelEntity old
            ON COALESCE(old.MediaRef, '') = ''
           AND old.WorkspaceRef  = cur.WorkspaceRef
           AND old.labelType     = cur.labelType
           AND old.canonicalName = cur.canonicalName
           AND old.provider      = cur.provider
         WHERE cur.id = ${table}.LabelEntityRef
           AND COALESCE(cur.MediaRef, '') <> ''
      )
    `;
    for (const table of ["LabelTrack"].concat(
      ALL_LEAVES.map((leaf) => leaf.table)
    )) {
      app.db().newQuery(repoint(table)).execute();
    }

    // Only rows nothing points at any more: a per-instance row whose group
    // never got a collapsed cluster still holds the only copy of its link.
    app.db().newQuery(`
      DELETE FROM LabelEntity
       WHERE COALESCE(MediaRef, '') <> ''
         AND NOT EXISTS (SELECT 1 FROM LabelTrack    x WHERE x.LabelEntityRef = LabelEntity.id)
         AND NOT EXISTS (SELECT 1 FROM LabelObjects  x WHERE x.LabelEntityRef = LabelEntity.id)
         AND NOT EXISTS (SELECT 1 FROM LabelFaces    x WHERE x.LabelEntityRef = LabelEntity.id)
         AND NOT EXISTS (SELECT 1 FROM LabelPerson   x WHERE x.LabelEntityRef = LabelEntity.id)
         AND NOT EXISTS (SELECT 1 FROM LabelSpeech   x WHERE x.LabelEntityRef = LabelEntity.id)
         AND NOT EXISTS (SELECT 1 FROM LabelSpeaker  x WHERE x.LabelEntityRef = LabelEntity.id)
         AND NOT EXISTS (SELECT 1 FROM LabelText     x WHERE x.LabelEntityRef = LabelEntity.id)
         AND NOT EXISTS (SELECT 1 FROM LabelShots    x WHERE x.LabelEntityRef = LabelEntity.id)
         AND NOT EXISTS (SELECT 1 FROM LabelSegments x WHERE x.LabelEntityRef = LabelEntity.id)
    `).execute();
  } catch (err) {
    throw new Error("LabelEntity per-instance rollback failed: " + err);
  }

  const collection = app.findCollectionByNameOrId("LabelEntity");

  collection.indexes = collection.indexes.filter(
    (idx) => idx !== MEDIA_TYPE_INDEX && idx !== MEDIA_INSTANCE_INDEX
  );
  collection.fields.removeByName("MediaRef");
  collection.fields.removeByName("instanceId");

  return app.save(collection);
});
