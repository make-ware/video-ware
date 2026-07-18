import { baseSchema } from 'pocketbase-zod-schema/schema';
import { z } from 'zod';

/**
 * EntityStats is a read-only PocketBase VIEW collection (defined in a
 * hand-written migration, not via defineCollection). One row per Entity with
 * the cross-media rollups the entities home page's cards display, following
 * the attribution precedence rule (track link wins, provider cluster link
 * applies only where the track is unlinked).
 */
export const EntityStatsSchema = z
  .object({
    /** Owning workspace (stored as the workspace id; used for filtering). */
    WorkspaceRef: z.string(),
    /** Attributed LabelTrack rows — the entity's tracked appearances. */
    trackCount: z.number(),
    /** Distinct media those tracks appear in. */
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
