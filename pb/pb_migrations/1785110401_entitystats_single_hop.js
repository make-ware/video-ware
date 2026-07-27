/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// EntityStats v2: resolve attribution through LabelEntity alone.
//
// The original view spelled out the two-level precedence rule
//   lt.EntityRef = e.id OR (COALESCE(lt.EntityRef,'') = '' AND le.EntityRef = e.id)
// nine separate times, plus two more INNER-JOIN variants for LabelShots and
// LabelSegments (which have no LabelTrackRef at all). LabelEntity is now
// per-media and per-instance and carries the only link, so each of those
// collapses to a single join on LabelEntityRef and the shots/segments special
// case disappears.
//
// mediaCount gets materially better: it used to mean "distinct media among
// the entity's tracks", which silently excluded any media whose only link was
// through a trackless shot or segment. LabelEntity carries MediaRef, so it is
// now just a COUNT(DISTINCT) over the entity's own rows.
//
// Structural constraints preserved: the top level stays `FROM Entities e`
// with a bare e.WorkspaceRef column (wrapping it in a subquery degrades every
// column to json and breaks the membership listRule), and there is no
// top-level UNION.
// ---------------------------------------------------------------------------

const VIEW_QUERY = `
  SELECT
    e.id AS id,
    e.WorkspaceRef AS WorkspaceRef,

    (SELECT COUNT(*)
       FROM LabelTrack lt
       JOIN LabelEntity le ON le.id = lt.LabelEntityRef
      WHERE le.EntityRef = e.id) AS trackCount,

    (SELECT COUNT(DISTINCT le.MediaRef)
       FROM LabelEntity le
      WHERE le.EntityRef = e.id
        AND COALESCE(le.MediaRef, '') <> '') AS mediaCount,

    (SELECT COUNT(*)
       FROM LabelSpeaker x
       JOIN LabelEntity le ON le.id = x.LabelEntityRef
      WHERE le.EntityRef = e.id) AS utteranceCount,

    ((SELECT COUNT(*) FROM LabelObjects  x JOIN LabelEntity le ON le.id = x.LabelEntityRef WHERE le.EntityRef = e.id)
   + (SELECT COUNT(*) FROM LabelPerson   x JOIN LabelEntity le ON le.id = x.LabelEntityRef WHERE le.EntityRef = e.id)
   + (SELECT COUNT(*) FROM LabelSpeech   x JOIN LabelEntity le ON le.id = x.LabelEntityRef WHERE le.EntityRef = e.id)
   + (SELECT COUNT(*) FROM LabelSpeaker  x JOIN LabelEntity le ON le.id = x.LabelEntityRef WHERE le.EntityRef = e.id)
   + (SELECT COUNT(*) FROM LabelFaces    x JOIN LabelEntity le ON le.id = x.LabelEntityRef WHERE le.EntityRef = e.id)
   + (SELECT COUNT(*) FROM LabelText     x JOIN LabelEntity le ON le.id = x.LabelEntityRef WHERE le.EntityRef = e.id)
   + (SELECT COUNT(*) FROM LabelShots    x JOIN LabelEntity le ON le.id = x.LabelEntityRef WHERE le.EntityRef = e.id)
   + (SELECT COUNT(*) FROM LabelSegments x JOIN LabelEntity le ON le.id = x.LabelEntityRef WHERE le.EntityRef = e.id)
    ) AS labelCount,

    (SELECT lt.id
       FROM LabelTrack lt
       JOIN LabelEntity le ON le.id = lt.LabelEntityRef
      WHERE le.EntityRef = e.id
      ORDER BY (json_array_length(COALESCE(NULLIF(lt.keyframes, ''), '[]')) > 0) DESC,
               lt.duration DESC, lt.id
      LIMIT 1) AS thumbTrack
  FROM Entities e
`;

// The pre-migration query, restored verbatim on rollback.
const PREVIOUS_QUERY = `
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
    ((SELECT COUNT(*) FROM LabelObjects x LEFT JOIN LabelTrack lt ON lt.id = x.LabelTrackRef LEFT JOIN LabelEntity le ON le.id = x.LabelEntityRef WHERE lt.EntityRef = e.id OR (COALESCE(lt.EntityRef,'') = '' AND le.EntityRef = e.id))
   + (SELECT COUNT(*) FROM LabelPerson x LEFT JOIN LabelTrack lt ON lt.id = x.LabelTrackRef LEFT JOIN LabelEntity le ON le.id = x.LabelEntityRef WHERE lt.EntityRef = e.id OR (COALESCE(lt.EntityRef,'') = '' AND le.EntityRef = e.id))
   + (SELECT COUNT(*) FROM LabelSpeech x LEFT JOIN LabelTrack lt ON lt.id = x.LabelTrackRef LEFT JOIN LabelEntity le ON le.id = x.LabelEntityRef WHERE lt.EntityRef = e.id OR (COALESCE(lt.EntityRef,'') = '' AND le.EntityRef = e.id))
   + (SELECT COUNT(*) FROM LabelSpeaker x LEFT JOIN LabelTrack lt ON lt.id = x.LabelTrackRef LEFT JOIN LabelEntity le ON le.id = x.LabelEntityRef WHERE lt.EntityRef = e.id OR (COALESCE(lt.EntityRef,'') = '' AND le.EntityRef = e.id))
   + (SELECT COUNT(*) FROM LabelFaces x LEFT JOIN LabelTrack lt ON lt.id = x.LabelTrackRef LEFT JOIN LabelEntity le ON le.id = x.LabelEntityRef WHERE lt.EntityRef = e.id OR (COALESCE(lt.EntityRef,'') = '' AND le.EntityRef = e.id))
   + (SELECT COUNT(*) FROM LabelText x LEFT JOIN LabelTrack lt ON lt.id = x.LabelTrackRef LEFT JOIN LabelEntity le ON le.id = x.LabelEntityRef WHERE lt.EntityRef = e.id OR (COALESCE(lt.EntityRef,'') = '' AND le.EntityRef = e.id))
   + (SELECT COUNT(*) FROM LabelShots x JOIN LabelEntity le ON le.id = x.LabelEntityRef WHERE le.EntityRef = e.id)
   + (SELECT COUNT(*) FROM LabelSegments x JOIN LabelEntity le ON le.id = x.LabelEntityRef WHERE le.EntityRef = e.id)) AS labelCount,
    (SELECT lt.id FROM LabelTrack lt
       LEFT JOIN LabelEntity le ON le.id = lt.LabelEntityRef
      WHERE lt.EntityRef = e.id OR (COALESCE(lt.EntityRef,'') = '' AND le.EntityRef = e.id)
      ORDER BY (json_array_length(COALESCE(NULLIF(lt.keyframes, ''), '[]')) > 0) DESC,
               lt.duration DESC, lt.id
      LIMIT 1) AS thumbTrack
  FROM Entities e
`;

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('EntityStats');
    collection.viewQuery = VIEW_QUERY;
    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('EntityStats');
    collection.viewQuery = PREVIOUS_QUERY;
    return app.save(collection);
  }
);
