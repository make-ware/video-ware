/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// MediaEntities v2: two union branches instead of four.
//
// The original needed one branch per way a label could reach an entity: a
// LabelTrack branch with a CASE WHEN encoding track-over-cluster precedence,
// plus separate branches for LabelSegments and LabelShots because those have
// no LabelTrackRef. LabelEntity now carries both MediaRef and the only
// EntityRef, so all three collapse into a single scan of the media's
// entities, and the precedence CASE disappears with them.
//
// This also closes the trade-off the original documented: it resolved cluster
// links THROUGH LabelTrack to keep the work bounded, which meant "a leaf label
// carrying a LabelEntityRef but no LabelTrackRef contributes nothing here."
// Reading LabelEntity directly is both cheaper and complete.
//
// `links` stays comparable: LabelEntity is 1:1 with LabelTrack for tracked
// types and 1:1 with the leaf row for shots and segments, so the per-entity
// counts match what the old three branches produced.
//
// Structural constraints preserved: top level stays `FROM Media m` with a bare
// m.WorkspaceRef (a wrapping subquery degrades every column to json and breaks
// the membership listRule), and the UNION stays inside the scalar subquery
// because PocketBase's view parser rejects a top-level UNION.
// ---------------------------------------------------------------------------

const VIEW_QUERY = `
  SELECT
    m.id AS id,
    m.WorkspaceRef AS WorkspaceRef,
    (SELECT json_group_array(json_object(
              'id', g.eid, 'name', g.name, 'kind', g.kind,
              'tagged', g.tagged, 'links', g.links))
       FROM (
         SELECT ed.eid AS eid, e.name AS name, e.kind AS kind,
                MAX(ed.tagged) AS tagged,
                COUNT(*)       AS links
           FROM (
                SELECT mt.EntityRef AS eid, 1 AS tagged
                  FROM MediaTags mt
                 WHERE mt.MediaRef = m.id AND mt.EntityRef <> ''
                UNION ALL
                SELECT le.EntityRef, 0
                  FROM LabelEntity le
                 WHERE le.MediaRef = m.id AND le.EntityRef <> ''
           ) ed
           JOIN Entities e ON e.id = ed.eid
          GROUP BY ed.eid
          ORDER BY MAX(ed.tagged) DESC, COUNT(*) DESC, e.name
       ) g) AS entities
  FROM Media m
`;

// The pre-migration query, restored verbatim on rollback.
const PREVIOUS_QUERY = `
  SELECT
    m.id AS id,
    m.WorkspaceRef AS WorkspaceRef,
    (SELECT json_group_array(json_object(
              'id', g.eid, 'name', g.name, 'kind', g.kind,
              'tagged', g.tagged, 'links', g.links))
       FROM (
         SELECT ed.eid AS eid, e.name AS name, e.kind AS kind,
                MAX(ed.tagged) AS tagged,
                COUNT(*)       AS links
           FROM (
                SELECT mt.EntityRef AS eid, 1 AS tagged
                  FROM MediaTags mt
                 WHERE mt.MediaRef = m.id AND mt.EntityRef <> ''
                UNION ALL
                SELECT CASE WHEN lt.EntityRef <> '' THEN lt.EntityRef
                            ELSE le.EntityRef END, 0
                  FROM LabelTrack lt
                  LEFT JOIN LabelEntity le ON le.id = lt.LabelEntityRef
                 WHERE lt.MediaRef = m.id
                   AND (lt.EntityRef <> '' OR COALESCE(le.EntityRef, '') <> '')
                UNION ALL
                SELECT le.EntityRef, 0
                  FROM LabelSegments x
                  JOIN LabelEntity le ON le.id = x.LabelEntityRef
                 WHERE x.MediaRef = m.id AND le.EntityRef <> ''
                UNION ALL
                SELECT le.EntityRef, 0
                  FROM LabelShots x
                  JOIN LabelEntity le ON le.id = x.LabelEntityRef
                 WHERE x.MediaRef = m.id AND le.EntityRef <> ''
           ) ed
           JOIN Entities e ON e.id = ed.eid
          GROUP BY ed.eid
          ORDER BY MAX(ed.tagged) DESC, COUNT(*) DESC, e.name
       ) g) AS entities
  FROM Media m
`;

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('MediaEntities');
    collection.viewQuery = VIEW_QUERY;
    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('MediaEntities');
    collection.viewQuery = PREVIOUS_QUERY;
    return app.save(collection);
  }
);
