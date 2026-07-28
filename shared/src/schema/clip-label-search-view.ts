import {
  baseSchema,
  defineView,
  sql,
  RelationField,
} from 'pocketbase-zod-schema/schema';
import { memberRule } from '../utils/collection-permissions';
import { z } from 'zod';

/**
 * ClipLabelSearch is a read-only PocketBase VIEW collection powering universal
 * search in the timeline editor. Each row is a (MediaClip, overlapping label)
 * pair: a clip whose [start, end] window overlaps a label on the same media,
 * across objects / tags / transcripts.
 *
 * The view intentionally returns only the matched clip id + match metadata;
 * clip/media/thumbnail details are hydrated from the MediaClips collection,
 * so we don't depend on relation `expand` working through a view.
 */
export const ClipLabelSearchSchema = z
  .object({
    /** Owning workspace (stored as the workspace id; used for filtering). */
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
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

/**
 * The UNION is wrapped in a subquery so the top-level SELECT exposes only
 * clean aliased columns (PocketBase's view-query parser rejects a top-level
 * UNION). `end` is quoted because it is a SQLite keyword.
 */
export const ClipLabelSearchCollection = defineView({
  collectionName: 'ClipLabelSearch',
  schema: ClipLabelSearchSchema,
  viewQuery: sql`
    SELECT t.id AS id,
           t.WorkspaceRef AS WorkspaceRef,
           t.clipId AS clipId,
           t.category AS category,
           t.matchText AS matchText,
           t.confidence AS confidence
    FROM (
      SELECT (mc.id || ':obj:' || lo.id) AS id,
             mc.WorkspaceRef AS WorkspaceRef,
             mc.id AS clipId,
             'objects' AS category,
             lo.entity AS matchText,
             lo.confidence AS confidence
      FROM MediaClips mc
      JOIN LabelObjects lo
        ON lo.MediaRef = mc.MediaRef
       AND lo.start < mc."end" AND lo."end" > mc.start
      UNION ALL
      SELECT (mc.id || ':seg:' || sg.id),
             mc.WorkspaceRef, mc.id, 'tags', sg.entity, sg.confidence
      FROM MediaClips mc
      JOIN LabelSegments sg
        ON sg.MediaRef = mc.MediaRef
       AND sg.start < mc."end" AND sg."end" > mc.start
      UNION ALL
      SELECT (mc.id || ':spe:' || sp.id),
             mc.WorkspaceRef, mc.id, 'transcripts', sp.transcript, sp.confidence
      FROM MediaClips mc
      JOIN LabelSpeech sp
        ON sp.MediaRef = mc.MediaRef
       AND sp.start < mc."end" AND sp."end" > mc.start
    ) t
  `,
  permissions: {
    listRule: memberRule('WorkspaceRef'),
    viewRule: memberRule('WorkspaceRef'),
  },
});

export default ClipLabelSearchCollection;

export type ClipLabelSearch = z.infer<typeof ClipLabelSearchSchema>;
