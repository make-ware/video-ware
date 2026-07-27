import { baseSchema } from 'pocketbase-zod-schema/schema';
import { z } from 'zod';

/**
 * ClipLabelSearch is a read-only PocketBase VIEW collection (defined in a
 * hand-written migration, not via defineCollection). Each row is a
 * (MediaClip, overlapping label) pair: a clip whose [start, end] window
 * overlaps a label on the same media, across objects / tags / transcripts.
 *
 * The view intentionally returns only the matched clip id + match metadata;
 * clip/media/thumbnail details are hydrated from the MediaClips collection,
 * so we don't depend on relation `expand` working through a view.
 */
export const ClipLabelSearchSchema = z
  .object({
    /** Owning workspace (stored as the workspace id; used for filtering). */
    WorkspaceRef: z.string(),
    /** The matched MediaClip id (hydrate via MediaClips for details). */
    clipId: z.string(),
    /** Search category: 'objects' | 'tags' | 'transcripts'. */
    category: z.string(),
    /** The label text that matched (entity name or transcript). */
    matchText: z.string(),
    /** Label confidence (0..1) — used for ranking. */
    confidence: z.number(),
  })
  .extend(baseSchema);

export type ClipLabelSearch = z.infer<typeof ClipLabelSearchSchema>;
