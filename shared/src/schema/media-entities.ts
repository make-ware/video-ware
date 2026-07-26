import { baseSchema } from 'pocketbase-zod-schema/schema';
import { z } from 'zod';

/**
 * One entity attached to a media, as produced by the `MediaEntities` view.
 *
 * `tagged` is 1 when at least one MediaTags row backs the link (a curator's
 * whole-media tag) and 0 when it comes only from label attribution;
 * `links` counts the rows behind it (tags + tracks + cluster rows).
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
 * MediaEntities is a read-only PocketBase VIEW collection (defined in a
 * hand-written migration, not via defineCollection): one row per Media, keyed
 * by the media id, whose `entities` array merges every way an Entity can be
 * attached to that media — MediaTags, LabelTrack links (direct, else the
 * provider cluster's link), and cluster links for the two label types without
 * a track. Answers "which entities are in this media" in one request per page
 * of media instead of ~10 queries per media.
 *
 * Rows arrive curated-first, then by link count, then name. Read them through
 * `MediaEntitiesMutator`, which normalizes the JSON column; relation `expand`
 * does not cross a view, so entity details are embedded rather than expanded.
 */
export const MediaEntitiesSchema = z
  .object({
    /** Owning workspace (stored as the workspace id; used for filtering). */
    WorkspaceRef: z.string(),
    /** Entities attached to this media. */
    entities: z.array(MediaEntityLinkSchema),
  })
  .extend(baseSchema);

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
