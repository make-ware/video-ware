import {
  baseSchema,
  defineView,
  sql,
  RelationField,
} from 'pocketbase-zod-schema';
import { memberRule } from '../utils/collection-permissions';
import { z } from 'zod';

/**
 * One entity attached to a media, as produced by the `MediaEntities` view.
 *
 * `tagged` is 1 when at least one MediaTags row backs the link (a curator's
 * whole-media tag) and 0 when it comes only from label attribution;
 * `links` counts the rows behind it (MediaTags + attributed LabelEntity
 * rows) — so one per track for tracked types, and one per label class for
 * shots and segments however many intervals carry that label.
 */
export const MediaEntityLinkSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  tagged: z.number(),
  links: z.number(),
});

export type MediaEntityLink = z.infer<typeof MediaEntityLinkSchema>;

/**
 * MediaEntities is a read-only PocketBase VIEW collection: one row per Media,
 * keyed by the media id, whose `entities` array merges the two ways an Entity can
 * be attached to that media — whole-media MediaTags, and attributed
 * LabelEntity rows (the per-media, per-instance link point every label type
 * shares). Answers "which entities are in this media" in one request per page
 * of media instead of ~10 queries per media.
 *
 * Rows arrive curated-first, then by link count, then name. Read them through
 * `MediaEntitiesMutator`, which normalizes the JSON column; relation `expand`
 * does not cross a view, so entity details are embedded rather than expanded.
 */
export const MediaEntitiesSchema = z
  .object({
    /** Owning workspace (stored as the workspace id; used for filtering). */
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    /** Entities attached to this media. */
    entities: z.array(MediaEntityLinkSchema),
  })
  .extend(baseSchema);

/**
 * Reading the entity rows instead of the label rows means a LabelEntity that
 * outlives its labels would keep claiming a detection. Media deletion cascades
 * (LabelEntity.MediaRef), and pb_hooks/hook-label-entity-gc.pb.js collects the
 * finer-grained case — the last track or leaf row for an instance being
 * deleted — so this view stays honest without re-growing the join.
 *
 * Structural constraints on the query: the top level stays `FROM Media m` with
 * a bare `m.WorkspaceRef` (a wrapping subquery degrades every column to json
 * and breaks the membership listRule), and the UNION stays inside the scalar
 * subquery because PocketBase's view parser rejects a top-level UNION.
 */
export const MediaEntitiesCollection = defineView({
  collectionName: 'MediaEntities',
  schema: MediaEntitiesSchema,
  viewQuery: sql`
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
  `,
  permissions: {
    listRule: memberRule('WorkspaceRef'),
    viewRule: memberRule('WorkspaceRef'),
  },
});

export default MediaEntitiesCollection;

export type MediaEntities = z.infer<typeof MediaEntitiesSchema>;

/**
 * Coerce the view's `entities` column into links, tolerating both a parsed
 * array and the raw `json_group_array` text, and dropping unrecognized items
 * rather than failing a whole page of cards.
 */
export function mediaEntityLinksOf(value: unknown): MediaEntityLink[] {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const links: MediaEntityLink[] = [];
  for (const item of raw) {
    const parsed = MediaEntityLinkSchema.safeParse(item);
    if (parsed.success) links.push(parsed.data);
  }
  return links;
}

/** Whether a link includes a curator's whole-media tag (vs. label-only). */
export function isCuratedTag(link: MediaEntityLink): boolean {
  return link.tagged > 0;
}
