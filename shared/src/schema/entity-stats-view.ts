import { baseSchema } from 'pocketbase-zod-schema/schema';
import { z } from 'zod';

/**
 * EntityStats is a read-only PocketBase VIEW collection (defined in a
 * hand-written migration, not via defineCollection). One row per Entity with
 * the cross-media rollups the entities home page's cards display. Attribution
 * resolves through LabelEntity.EntityRef alone — the model's single link
 * point, per media and per detected instance.
 */
export const EntityStatsSchema = z
  .object({
    /** Owning workspace (stored as the workspace id; used for filtering). */
    WorkspaceRef: z.string(),
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

export type EntityStats = z.infer<typeof EntityStatsSchema>;
