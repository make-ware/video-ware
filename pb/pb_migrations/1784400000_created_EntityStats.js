/// <reference path="../pb_data/types.d.ts" />

// EntityStats is a read-only VIEW collection powering the entities home
// page's cards: one row per Entity with the cross-media rollups the entity
// detail header computes client-side (media / tracked appearances /
// utterances / linked labels) plus a representative track for the card's
// thumbnail. Fetching one page of entities' stats is a single list request
// instead of ~10 per entity.
//
// Attribution follows the precedence rule from shared/src/mutators/entity.ts:
// an explicit track link (LabelTrack.EntityRef) wins; the provider cluster
// (LabelEntity.EntityRef) only applies where the track link is unset. Label
// collections without a LabelTrackRef field (LabelShots, LabelSegments) only
// have the cluster link point.
//
// Notes:
// - `utteranceCount` (LabelSpeaker) is also part of `labelCount`, mirroring
//   the detail page where "Linked Labels" sums all eight label types.
// - `thumbTrack` prefers the longest track WITH keyframes (face/person bbox
//   crops make recognizable thumbnails); entities linked only through
//   speaker tracks fall back to their longest track, whose media midpoint
//   frame the webapp renders instead.
// - COALESCE(x.EntityRef, '') = '' covers both "no track linked" (join is
//   NULL) and "track linked but unattributed" ('' in the relation column),
//   matching PocketBase's `LabelTrackRef.EntityRef = ""` filter semantics.
migrate(
  (app) => {
    const viewQuery = `
      SELECT
        e.id AS id,
        e.WorkspaceRef AS WorkspaceRef,
        (SELECT COUNT(*)
           FROM LabelTrack lt
           LEFT JOIN LabelEntity le ON le.id = lt.LabelEntityRef
          WHERE lt.EntityRef = e.id
             OR (COALESCE(lt.EntityRef, '') = '' AND le.EntityRef = e.id)) AS trackCount,
        (SELECT COUNT(DISTINCT lt.MediaRef)
           FROM LabelTrack lt
           LEFT JOIN LabelEntity le ON le.id = lt.LabelEntityRef
          WHERE lt.EntityRef = e.id
             OR (COALESCE(lt.EntityRef, '') = '' AND le.EntityRef = e.id)) AS mediaCount,
        (SELECT COUNT(*)
           FROM LabelSpeaker x
           LEFT JOIN LabelTrack lt ON lt.id = x.LabelTrackRef
           LEFT JOIN LabelEntity le ON le.id = x.LabelEntityRef
          WHERE lt.EntityRef = e.id
             OR (COALESCE(lt.EntityRef, '') = '' AND le.EntityRef = e.id)) AS utteranceCount,
        ((SELECT COUNT(*)
            FROM LabelObjects x
            LEFT JOIN LabelTrack lt ON lt.id = x.LabelTrackRef
            LEFT JOIN LabelEntity le ON le.id = x.LabelEntityRef
           WHERE lt.EntityRef = e.id
              OR (COALESCE(lt.EntityRef, '') = '' AND le.EntityRef = e.id))
         + (SELECT COUNT(*)
            FROM LabelPerson x
            LEFT JOIN LabelTrack lt ON lt.id = x.LabelTrackRef
            LEFT JOIN LabelEntity le ON le.id = x.LabelEntityRef
           WHERE lt.EntityRef = e.id
              OR (COALESCE(lt.EntityRef, '') = '' AND le.EntityRef = e.id))
         + (SELECT COUNT(*)
            FROM LabelSpeech x
            LEFT JOIN LabelTrack lt ON lt.id = x.LabelTrackRef
            LEFT JOIN LabelEntity le ON le.id = x.LabelEntityRef
           WHERE lt.EntityRef = e.id
              OR (COALESCE(lt.EntityRef, '') = '' AND le.EntityRef = e.id))
         + (SELECT COUNT(*)
            FROM LabelSpeaker x
            LEFT JOIN LabelTrack lt ON lt.id = x.LabelTrackRef
            LEFT JOIN LabelEntity le ON le.id = x.LabelEntityRef
           WHERE lt.EntityRef = e.id
              OR (COALESCE(lt.EntityRef, '') = '' AND le.EntityRef = e.id))
         + (SELECT COUNT(*)
            FROM LabelFaces x
            LEFT JOIN LabelTrack lt ON lt.id = x.LabelTrackRef
            LEFT JOIN LabelEntity le ON le.id = x.LabelEntityRef
           WHERE lt.EntityRef = e.id
              OR (COALESCE(lt.EntityRef, '') = '' AND le.EntityRef = e.id))
         + (SELECT COUNT(*)
            FROM LabelText x
            LEFT JOIN LabelTrack lt ON lt.id = x.LabelTrackRef
            LEFT JOIN LabelEntity le ON le.id = x.LabelEntityRef
           WHERE lt.EntityRef = e.id
              OR (COALESCE(lt.EntityRef, '') = '' AND le.EntityRef = e.id))
         + (SELECT COUNT(*)
            FROM LabelShots x
            JOIN LabelEntity le ON le.id = x.LabelEntityRef
           WHERE le.EntityRef = e.id)
         + (SELECT COUNT(*)
            FROM LabelSegments x
            JOIN LabelEntity le ON le.id = x.LabelEntityRef
           WHERE le.EntityRef = e.id)) AS labelCount,
        (SELECT lt.id
           FROM LabelTrack lt
           LEFT JOIN LabelEntity le ON le.id = lt.LabelEntityRef
          WHERE lt.EntityRef = e.id
             OR (COALESCE(lt.EntityRef, '') = '' AND le.EntityRef = e.id)
          ORDER BY (json_array_length(COALESCE(NULLIF(lt.keyframes, ''), '[]')) > 0) DESC,
                   lt.duration DESC,
                   lt.id
          LIMIT 1) AS thumbTrack
      FROM Entities e
    `;

    const collection = new Collection({
      id: 'pb_entitystats001',
      name: 'EntityStats',
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
    const collection = app.findCollectionByNameOrId('EntityStats');
    return app.delete(collection);
  }
);
