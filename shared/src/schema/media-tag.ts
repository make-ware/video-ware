import {
  defineCollection,
  RelationField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { workspaceScopedPermissions } from '../utils/collection-permissions';
import { z } from 'zod';
import type { Entity } from './entity';
import type { Media } from './media';
import type { Workspace } from './workspace';

/**
 * MediaTags is a manual whole-media tag: "this media features this Entity".
 * It is deliberately NOT a label type — label collections hold provider
 * detections (time-anchored segments, confidence, tracks/clusters), while a
 * tag is a curator's statement about the media as a whole. It complements the
 * two label-cluster link points (LabelTrack.EntityRef / LabelEntity.EntityRef)
 * as a third, media-level way to associate an Entity.
 *
 * One row per (media, entity) edge — the unique index makes tagging
 * idempotent and races resolve to the desired end state.
 */
export const MediaTagSchema = z
  .object({
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    MediaRef: RelationField({ collection: 'Media' }),
    EntityRef: RelationField({ collection: 'Entities' }),
    metadata: JSONField().optional(), // tag context, e.g. provenance notes
  })
  .extend(baseSchema);

// Define input schema for creating media tags
export const MediaTagInputSchema = z.object({
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  MediaRef: z.string().min(1, 'Media is required'),
  EntityRef: z.string().min(1, 'Entity is required'),
  metadata: JSONField().optional(),
});

// Define the collection with workspace-scoped permissions
export const MediaTagCollection = defineCollection({
  collectionName: 'MediaTags',
  schema: MediaTagSchema,
  permissions: workspaceScopedPermissions(),
  indexes: [
    // One tag per (media, entity) edge — tagging twice is a no-op, not a dup
    'CREATE UNIQUE INDEX idx_media_tags_media_entity ON MediaTags (MediaRef, EntityRef)',
    // "Which media feature this entity" listings
    'CREATE INDEX idx_media_tags_entity ON MediaTags (EntityRef)',
    'CREATE INDEX idx_media_tags_workspace ON MediaTags (WorkspaceRef)',
  ],
});

export default MediaTagCollection;

// Export TypeScript types
export type MediaTag = z.infer<typeof MediaTagSchema>;
export type MediaTagInput = z.infer<typeof MediaTagInputSchema>;
export type MediaTagUpdate = Partial<MediaTagInput>;

export interface MediaTagRelations {
  WorkspaceRef?: Workspace;
  MediaRef?: Media;
  EntityRef?: Entity;
}
