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
// LabelTrackRef at all). LabelEntity carries EntityRef and is the only link
// point; LabelTrack keeps the heavy payload (keyframes, boundingBox,
// trackData) and stops being an identity holder.
//
// The crux is step 2: the OLD two-level precedence rule (track link wins, the
// cluster link is the fallback) is resolved ONCE HERE, into data —
//   EntityRef = COALESCE(NULLIF(track.EntityRef,''), cluster.EntityRef)
// so every manual "this track is Erik" survives with the same meaning, and the
// runtime rule can be deleted from the eight places it was written.
//
// LabelTrack.EntityRef is deliberately LEFT IN PLACE AND POPULATED. Nothing
// reads it after this migration; it stays as the recovery net. Dropping it is
// a separate, later migration once this model has run in anger.
//
// Rollback honesty: the down migration restores the collapsed cluster rows and
// repoints refs at them, but it CANNOT reproduce the original entityHash
// values — those were SHA-256 digests and SQLite has no SHA-256. Rolling back
// leaves structurally-correct clusters with plain-text keys. For exact
// fidelity, restore the pb_data/data.db backup taken before running this.
//
// Every data statement is idempotent (INSERT OR IGNORE against the unique
// entityHash index, plus a `legacy row` guard of MediaRef = '') and wrapped in
// try/catch — a throw inside a boot migration rolls back startup and
// PocketBase never opens its port.
// ---------------------------------------------------------------------------

const MEDIA_TYPE_INDEX =
  "CREATE INDEX idx_label_entity_media_type ON LabelEntity (MediaRef, labelType)";
const MEDIA_INSTANCE_INDEX =
  "CREATE INDEX idx_label_entity_media_instance ON LabelEntity (MediaRef, instanceId)";

// PocketBase's own id default, reused so migration-minted rows are
// indistinguishable from API-minted ones.
const NEW_ID = "'r'||lower(hex(randomblob(7)))";
const NOW = "strftime('%Y-%m-%d %H:%M:%f','now')||'Z'";

// The six leaf collections that reach their entity through a track. Shots and
// segments are handled separately — they have no LabelTrackRef.
const TRACKED_LEAVES = [
  "LabelObjects",
  "LabelFaces",
  "LabelPerson",
  "LabelSpeech",
  "LabelSpeaker",
  "LabelText",
];

migrate((app) => {
  const collection = app.findCollectionByNameOrId("LabelEntity");

  collection.fields.add(new RelationField({
    name: "MediaRef",
    required: false, // optional so the backfill cannot fail on underivable rows
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

  app.save(collection);

  // Columns must exist before any of the SQL below runs.
  try {
    // --- Step 1: one LabelEntity per LabelTrack -----------------------------
    // Derives only from legacy cluster rows (MediaRef = ''), which is what
    // makes a re-run a no-op: after step 4 the tracks point at media-scoped
    // rows and this join finds nothing.
    app.db().newQuery(`
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
        lt.trackId,
        le.metadata,
        lt.WorkspaceRef || ':' || lt.MediaRef || ':' ||
          COALESCE(NULLIF(lt.labelType, ''), le.labelType) || ':' ||
          lt.trackId || ':' || le.provider,
        COALESCE(NULLIF(lt.EntityRef, ''), le.EntityRef, ''),
        ${NOW}, ${NOW}
      FROM LabelTrack lt
      JOIN LabelEntity le ON le.id = lt.LabelEntityRef
      WHERE COALESCE(le.MediaRef, '') = ''
    `).execute();

    // --- Step 2: one LabelEntity per LabelShots row -------------------------
    // instanceId is the row's own shotHash: shots are classifications with no
    // provider track, so the row itself is the instance.
    app.db().newQuery(`
      INSERT OR IGNORE INTO LabelEntity
        (id, WorkspaceRef, MediaRef, labelType, canonicalName, provider,
         processor, instanceId, metadata, entityHash, EntityRef, created, updated)
      SELECT
        ${NEW_ID}, s.WorkspaceRef, s.MediaRef, le.labelType, le.canonicalName,
        le.provider, le.processor, s.shotHash, le.metadata,
        s.WorkspaceRef || ':' || s.MediaRef || ':' || le.labelType || ':' ||
          s.shotHash || ':' || le.provider,
        COALESCE(le.EntityRef, ''),
        ${NOW}, ${NOW}
      FROM LabelShots s
      JOIN LabelEntity le ON le.id = s.LabelEntityRef
      WHERE COALESCE(le.MediaRef, '') = ''
    `).execute();

    // --- Step 3: one LabelEntity per LabelSegments row ----------------------
    app.db().newQuery(`
      INSERT OR IGNORE INTO LabelEntity
        (id, WorkspaceRef, MediaRef, labelType, canonicalName, provider,
         processor, instanceId, metadata, entityHash, EntityRef, created, updated)
      SELECT
        ${NEW_ID}, g.WorkspaceRef, g.MediaRef, le.labelType, le.canonicalName,
        le.provider, le.processor, g.segmentHash, le.metadata,
        g.WorkspaceRef || ':' || g.MediaRef || ':' || le.labelType || ':' ||
          g.segmentHash || ':' || le.provider,
        COALESCE(le.EntityRef, ''),
        ${NOW}, ${NOW}
      FROM LabelSegments g
      JOIN LabelEntity le ON le.id = g.LabelEntityRef
      WHERE COALESCE(le.MediaRef, '') = ''
    `).execute();

    // --- Step 4: repoint LabelTrack at its own entity -----------------------
    // Matched on (MediaRef, instanceId, labelType), verified unique across
    // LabelTrack before writing this. Guarded by EXISTS so a track with no
    // match keeps its current ref rather than being nulled.
    app.db().newQuery(`
      UPDATE LabelTrack SET LabelEntityRef = (
        SELECT ne.id FROM LabelEntity ne
         WHERE ne.MediaRef = LabelTrack.MediaRef
           AND ne.instanceId = LabelTrack.trackId
           AND ne.labelType = LabelTrack.labelType
      )
      WHERE EXISTS (
        SELECT 1 FROM LabelEntity ne
         WHERE ne.MediaRef = LabelTrack.MediaRef
           AND ne.instanceId = LabelTrack.trackId
           AND ne.labelType = LabelTrack.labelType
      )
    `).execute();

    // --- Step 5: repoint the six tracked leaf collections -------------------
    // Must follow step 4 — these read the track's freshly-repointed ref.
    for (const leaf of TRACKED_LEAVES) {
      app.db().newQuery(`
        UPDATE ${leaf} SET LabelEntityRef = (
          SELECT lt.LabelEntityRef FROM LabelTrack lt
           WHERE lt.id = ${leaf}.LabelTrackRef
        )
        WHERE COALESCE(${leaf}.LabelTrackRef, '') <> ''
          AND EXISTS (
            SELECT 1 FROM LabelTrack lt
             WHERE lt.id = ${leaf}.LabelTrackRef
               AND COALESCE(lt.LabelEntityRef, '') <> ''
          )
      `).execute();
    }

    // --- Step 6: repoint shots and segments at their own rows ---------------
    app.db().newQuery(`
      UPDATE LabelShots SET LabelEntityRef = (
        SELECT ne.id FROM LabelEntity ne
         WHERE ne.MediaRef = LabelShots.MediaRef
           AND ne.instanceId = LabelShots.shotHash
      )
      WHERE EXISTS (
        SELECT 1 FROM LabelEntity ne
         WHERE ne.MediaRef = LabelShots.MediaRef
           AND ne.instanceId = LabelShots.shotHash
      )
    `).execute();

    app.db().newQuery(`
      UPDATE LabelSegments SET LabelEntityRef = (
        SELECT ne.id FROM LabelEntity ne
         WHERE ne.MediaRef = LabelSegments.MediaRef
           AND ne.instanceId = LabelSegments.segmentHash
      )
      WHERE EXISTS (
        SELECT 1 FROM LabelEntity ne
         WHERE ne.MediaRef = LabelSegments.MediaRef
           AND ne.instanceId = LabelSegments.segmentHash
      )
    `).execute();

    // --- Step 7: drop legacy cluster rows nothing points at any more --------
    // The NOT EXISTS chain is the safety catch: a legacy row that somehow
    // still has a referrer survives (and MediaRef being optional keeps it
    // valid) rather than leaving a dangling ref behind.
    app.db().newQuery(`
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
    `).execute();
  } catch (err) {
    console.log("LabelEntity per-instance backfill failed (non-fatal): " + err);
  }

  return null;
}, (app) => {
  // Reverse: collapse per-instance rows back into workspace-wide clusters.
  // entityHash cannot be restored to its original SHA-256 (no SQLite digest),
  // so restored clusters carry a plain composite key. LabelTrack.EntityRef was
  // never modified, so the manual links are intact either way.
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
        '', ${NOW}, ${NOW}
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
         WHERE cur.id = ${table}.LabelEntityRef
           AND COALESCE(cur.MediaRef, '') <> ''
      )
    `;
    for (const table of ["LabelTrack"].concat(TRACKED_LEAVES,
      ["LabelShots", "LabelSegments"])) {
      app.db().newQuery(repoint(table)).execute();
    }

    app.db().newQuery(
      `DELETE FROM LabelEntity WHERE COALESCE(MediaRef, '') <> ''`
    ).execute();
  } catch (err) {
    console.log("LabelEntity per-instance rollback failed: " + err);
  }

  const collection = app.findCollectionByNameOrId("LabelEntity");

  collection.indexes = collection.indexes.filter(
    (idx) => idx !== MEDIA_TYPE_INDEX && idx !== MEDIA_INSTANCE_INDEX
  );
  collection.fields.removeByName("MediaRef");
  collection.fields.removeByName("instanceId");

  return app.save(collection);
});
