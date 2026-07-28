import {
  defineCollection,
  RelationField,
  SelectField,
  TextField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { workspaceScopedPermissions } from '../utils/collection-permissions';
import { z } from 'zod';
import { LabelType, ProcessingProvider } from '../enums';

// A LabelEntity is one provider-detected instance in one media — this diarized
// speaker, this face track, this tracked object — and it is THE link point
// between a label and a real-world Entity. It is deliberately lightweight:
// LabelTrack carries the heavy payload (keyframes at a 10 MB/record cap,
// bounding boxes, trackData) and every leaf label row hangs off the entity via
// LabelEntityRef, which is the only ref all eight leaf collections share
// (LabelShots and LabelSegments have no LabelTrackRef at all).
//
// It was previously one row per (workspace, labelType, canonicalName,
// provider) with no media scope, so a single "Speaker 1" row was shared by
// every media in the workspace — linking it to a person in one video silently
// claimed every other video's first speaker too.
export const LabelEntitySchema = z
  .object({
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    // The media this instance was detected in. Optional at the PocketBase
    // layer only so the per-instance backfill could not fail on rows with
    // nothing to derive a media from; LabelEntityInputSchema requires it, so
    // every write since is media-scoped.
    MediaRef: RelationField({
      collection: 'Media',
      cascadeDelete: true,
    }).optional(),
    labelType: SelectField([
      LabelType.OBJECT,
      LabelType.SHOT,
      LabelType.PERSON,
      LabelType.SPEECH,
      LabelType.SPEAKER,
      LabelType.FACE,
      LabelType.SEGMENT,
      LabelType.TEXT,
    ]),
    canonicalName: TextField({ min: 1 }), // e.g., "Car", "Person", "Interview", "Wilderness"
    provider: SelectField([
      ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
      ProcessingProvider.GOOGLE_SPEECH,
      ProcessingProvider.ELEVENLABS,
    ]),
    processor: TextField(), // e.g., "object-tracking:1.0.0"
    // The provider's key for this instance within the media: the trackId for
    // the six tracked types, the normalized label name for the two trackless
    // classification ones (shots and segments, where the instance is the class
    // — every "mountain" interval in a media is one thing to tag). Paired with
    // MediaRef it is what makes one row mean one thing rather than one word.
    instanceId: TextField().optional(),
    metadata: JSONField().optional(), // Provider-specific data
    // Uniqueness key, a readable composite rather than a digest —
    // "ws:media:labelType:instanceId:provider". Kept plain deliberately: it is
    // never compared across systems, and SQL migrations have to be able to
    // reconstruct it (SQLite has no SHA-256).
    entityHash: TextField({ min: 1 }),
    // The link to a real-world Entity — "this speaker is Erik". Per-media,
    // per-instance, and the single source of truth: nothing overrides it.
    EntityRef: RelationField({ collection: 'Entities' }).optional(),
  })
  .extend(baseSchema);

// Define input schema for creating label entities
export const LabelEntityInputSchema = z.object({
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  // Required here even though the PB field is optional — a new LabelEntity
  // without a media is the workspace-wide row this model exists to eliminate.
  MediaRef: z.string().min(1, 'Media is required'),
  labelType: z.enum([
    LabelType.OBJECT,
    LabelType.SHOT,
    LabelType.PERSON,
    LabelType.SPEECH,
    LabelType.SPEAKER,
    LabelType.FACE,
    LabelType.SEGMENT,
    LabelType.TEXT,
  ]),
  canonicalName: z.string().min(1, 'Canonical name is required'),
  provider: z.enum([
    ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
    ProcessingProvider.GOOGLE_SPEECH,
    ProcessingProvider.ELEVENLABS,
  ]),
  processor: z.string().min(1, 'Processor is required'),
  instanceId: z.string().min(1, 'Instance id is required'),
  metadata: JSONField().optional(),
  entityHash: z.string().min(1, 'Entity hash is required'),
  EntityRef: z.string().optional(),
});

// Define the collection with workspace-scoped permissions
export const LabelEntityCollection = defineCollection({
  collectionName: 'LabelEntity',
  schema: LabelEntitySchema,
  permissions: workspaceScopedPermissions(),
  indexes: [
    // Unique constraint on entityHash for deduplication
    'CREATE UNIQUE INDEX idx_label_entity_hash ON LabelEntity (entityHash)',
    // Index for workspace + labelType queries
    'CREATE INDEX idx_label_entity_workspace_type ON LabelEntity (WorkspaceRef, labelType)',
    // Index for canonicalName searches
    'CREATE INDEX idx_label_entity_canonical_name ON LabelEntity (canonicalName)',
    // Index for entity queries ("all label clusters linked to this entity")
    'CREATE INDEX idx_label_entity_entity ON LabelEntity (EntityRef)',
    // "This media's speaker/face entities" — the identification UIs.
    'CREATE INDEX idx_label_entity_media_type ON LabelEntity (MediaRef, labelType)',
    // Resolving one provider instance within a media.
    'CREATE INDEX idx_label_entity_media_instance ON LabelEntity (MediaRef, instanceId)',
  ],
});

export default LabelEntityCollection;

/**
 * The uniqueness key for one provider-detected instance in one media.
 *
 * This is the single definition of LabelEntity identity — it used to be a
 * SHA-256 of `ws:labelType:name:provider`, duplicated byte-for-byte in eight
 * places and, fatally, carrying no media scope. Two properties matter now:
 * `mediaId` is in the key, so an instance can never be shared across media;
 * and the key is plain text, so a SQL migration can reconstruct it (SQLite
 * has no SHA-256) and a human can read it in the admin UI.
 *
 * `instanceId` is the key for the instance within the media — the provider's
 * trackId for the six tracked types. For those it is NOT the canonical name:
 * two objects in one media can both be "food" and still be different
 * products. Shots and segments have no track and no tracked thing, so their
 * instance is the label class itself (the normalized name), which keeps a tag
 * on "mountain" covering every mountain interval in that media.
 *
 * Keep this in step with the SQL that rebuilds the key in
 * pb_migrations/1785110400_labelentity_per_instance.js.
 */
export function labelEntityKey(parts: {
  workspaceRef: string;
  mediaId: string;
  labelType: LabelType;
  instanceId: string;
  provider: ProcessingProvider;
}): string {
  const { workspaceRef, mediaId, labelType, instanceId, provider } = parts;
  return `${workspaceRef}:${mediaId}:${labelType}:${instanceId}:${provider}`;
}

// Export TypeScript types
export type LabelEntity = z.infer<typeof LabelEntitySchema>;
export type LabelEntityInput = z.infer<typeof LabelEntityInputSchema>;
export type LabelEntityUpdate = Partial<LabelEntityInput>;
