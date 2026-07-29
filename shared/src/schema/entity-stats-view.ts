import {
  baseSchema,
  defineView,
  sql,
  RelationField,
} from 'pocketbase-zod-schema';
import { memberRule } from '../utils/collection-permissions';
import { z } from 'zod';

/**
 * EntityStats is a read-only PocketBase VIEW collection. One row per Entity
 * with the cross-media rollups the entities home page's cards display.
 * Attribution resolves through LabelEntity.EntityRef alone — the model's
 * single link point, per media and per detected instance.
 */
export const EntityStatsSchema = z
  .object({
    /** Owning workspace (stored as the workspace id; used for filtering). */
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    /** Attributed LabelTrack rows — the entity's tracked appearances. */
    trackCount: z.number(),
    /**
     * Distinct media with any attributed LabelEntity — includes media whose
     * only link is a trackless shot or segment.
     */
    mediaCount: z.number(),
    /** Attributed LabelSpeaker rows — what the entity spoke. */
    utteranceCount: z.number(),
    /** Attributed label rows summed across all eight label types. */
    labelCount: z.number(),
    /**
     * Representative track for the card thumbnail: the longest attributed
     * track with keyframes, else the longest attributed track, else null.
     * Hydrate via the LabelTrack collection (expand doesn't cross the view).
     */
    thumbTrack: z.string().nullable(),
  })
  .extend(baseSchema);

/**
 * Structural constraints on the query: the top level stays `FROM Entities e`
 * with a bare `e.WorkspaceRef` column (wrapping it in a subquery degrades
 * every column to json and breaks the membership listRule), and there is no
 * top-level UNION.
 */
export const EntityStatsCollection = defineView({
  collectionName: 'EntityStats',
  schema: EntityStatsSchema,
  viewQuery: sql`
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
  `,
  permissions: {
    listRule: memberRule('WorkspaceRef'),
    viewRule: memberRule('WorkspaceRef'),
  },
});

export default EntityStatsCollection;

export type EntityStats = z.infer<typeof EntityStatsSchema>;
