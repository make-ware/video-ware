/// <reference path="../pb_data/types.d.ts" />

// MediaEntities is a read-only VIEW collection answering "which Entities are
// attached to this media": one row per Media whose `entities` column is a JSON
// array of the entity links, merged from all three link points —
//
//   - MediaTags        — the curator's whole-media tag (`tagged: 1`)
//   - LabelTrack       — a per-media detection track linked to an entity, or
//                        (when the track itself is unlinked) its provider
//                        cluster's link, following the precedence rule from
//                        shared/src/mutators/entity.ts
//   - LabelSegments /
//     LabelShots       — cluster links for the two label types that have no
//                        LabelTrackRef field
//
// It powers the media list page's per-card entity chips: one request per page
// of cards instead of ~10 queries per media.
//
// Notes:
// - `tagged` is 1 when at least one MediaTags row backs the entity, else 0;
//   `links` counts the rows (tags + tracks + cluster rows) behind it. Rows are
//   ordered curated-first, then by link count, then name.
// - Cluster links for the six track-bearing label types are resolved THROUGH
//   LabelTrack rather than by scanning the leaf label tables, which keeps the
//   per-media work bounded (tens of tracks vs. tens of thousands of object or
//   text rows). Trade-off: a leaf label carrying a LabelEntityRef but no
//   LabelTrackRef contributes nothing here.
// - The top-level SELECT must stay `FROM Media m` with a bare `m.WorkspaceRef`
//   column: PocketBase infers view field types from the outermost select, and
//   only then does WorkspaceRef become a real relation field that the
//   membership listRule can traverse. Wrapping the top level in a subquery
//   degrades every column to `json` (see ClipLabelSearch).
// - PocketBase's view parser rejects a top-level UNION, so the unions live
//   inside the scalar subquery.
// - SQLite applies the request's `id` filter before evaluating the select-list
//   subquery, so a page-of-ids request only resolves entities for those rows.
migrate(
  (app) => {
    const viewQuery = `
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

    const collection = new Collection({
      id: 'pb_mediaentities1',
      name: 'MediaEntities',
      type: 'view',
      listRule:
        'WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id',
      viewRule:
        'WorkspaceRef.WorkspaceMembers_via_WorkspaceRef.UserRef ?= @request.auth.id',
      createRule: null,
      updateRule: null,
      deleteRule: null,
      manageRule: null,
      viewQuery,
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('MediaEntities');
    return app.delete(collection);
  }
);
