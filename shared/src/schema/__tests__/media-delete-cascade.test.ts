import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { extractRelationMetadata } from 'pocketbase-zod-schema';
import * as collections from '../../schema';

/**
 * Deleting a Media must ALWAYS be possible.
 *
 * PocketBase resolves a reference to a record it is deleting one of two ways:
 * `cascadeDelete: true` deletes the referring row, anything else UNSETS the
 * reference and saves the row. It cannot unset a `required` field, so it
 * aborts the entire delete with
 *
 *   the record cannot be deleted because it is part of a required reference
 *   in record <id> (<collection> collection)
 *
 * That is not a per-row accident: a single required non-cascade reference
 * pointing anywhere into the media cascade closure wedges the delete for every
 * media that has such a row — and because PocketBase walks the referencing
 * collections in map order, it fails only sometimes, which is how
 * LabelFaces.LabelEntityRef went unnoticed until a user hit it (fixed by
 * pb/pb_migrations/1785731000_relax_label_refs_for_media_delete).
 *
 * These tests read the declarative schema — the same source
 * `pocketbase-migrate generate` reads — so a new required relation into the
 * closure fails here instead of in production. They cannot see the live
 * database (there is no drift check; see the note in
 * collection-permissions.test.ts), so a schema change still has to ship with a
 * hand-written migration.
 */

interface RelationEdge {
  /** Collection holding the relation field. */
  from: string;
  field: string;
  /** Collection the relation points at. */
  to: string;
  required: boolean;
  cascadeDelete: boolean;
}

/** Peel `.optional()` / `.nullable()` / `.default()` off a field. */
function unwrap(field: z.ZodType): z.ZodType {
  let current: z.ZodType = field;
  for (;;) {
    if (
      current instanceof z.ZodOptional ||
      current instanceof z.ZodNullable ||
      current instanceof z.ZodDefault
    ) {
      current = current.unwrap() as z.ZodType;
      continue;
    }
    return current;
  }
}

/** Mirrors the generator's rule: a wrapped field is not required. */
function isRequired(field: z.ZodType): boolean {
  return !(
    field instanceof z.ZodOptional ||
    field instanceof z.ZodNullable ||
    field instanceof z.ZodDefault
  );
}

/**
 * Every base (non-view) collection in `@project/shared`, keyed by the
 * PocketBase collection name `defineCollection` stamped into its description.
 * Views are excluded: they are SQL projections, so PocketBase never cascades
 * into or out of them.
 */
function baseCollections(): Map<string, z.ZodObject> {
  const found = new Map<string, z.ZodObject>();
  for (const exported of Object.values(collections)) {
    if (!(exported instanceof z.ZodObject)) continue;
    const description = exported.description;
    if (!description) continue;
    let metadata: { collectionName?: string; type?: string };
    try {
      metadata = JSON.parse(description);
    } catch {
      continue; // not a defineCollection() result
    }
    if (!metadata.collectionName || metadata.type === 'view') continue;
    found.set(metadata.collectionName, exported);
  }
  return found;
}

function relationEdges(): RelationEdge[] {
  const edges: RelationEdge[] = [];
  for (const [name, collection] of baseCollections()) {
    for (const [fieldName, field] of Object.entries(collection.shape)) {
      const relation = extractRelationMetadata(
        unwrap(field as z.ZodType).description
      );
      if (!relation) continue;
      edges.push({
        from: name,
        field: fieldName,
        to: relation.collection,
        required: isRequired(field as z.ZodType),
        cascadeDelete: relation.cascadeDelete,
      });
    }
  }
  return edges;
}

/**
 * Every collection whose rows a delete of `root` removes, followed
 * transitively (deleting a Media deletes its MediaClips, which deletes their
 * MediaClipLabels).
 */
function cascadeClosure(root: string, edges: RelationEdge[]): Set<string> {
  const deleted = new Set([root]);
  const queue = [root];
  while (queue.length > 0) {
    const target = queue.shift() as string;
    for (const edge of edges) {
      if (edge.to !== target || !edge.cascadeDelete) continue;
      if (deleted.has(edge.from)) continue;
      deleted.add(edge.from);
      queue.push(edge.from);
    }
  }
  return deleted;
}

describe('Media delete cascade', () => {
  const edges = relationEdges();
  const closure = cascadeClosure('Media', edges);

  it('reaps every per-media collection', () => {
    // Derived data must not outlive its media. A collection dropping out of
    // this list means its MediaRef lost `cascadeDelete` and its rows now
    // survive (orphaned) — or block the delete outright, since MediaRef is
    // required almost everywhere.
    for (const child of [
      'MediaClips',
      'MediaClipLabels',
      'MediaTags',
      'Captions',
      'Files',
      'LabelEntity',
      'LabelTrack',
      'LabelFaces',
      'LabelJobs',
      'LabelObjects',
      'LabelPerson',
      'LabelSegments',
      'LabelShots',
      'LabelSpeaker',
      'LabelSpeech',
      'LabelText',
    ]) {
      expect(closure.has(child), `${child} is not cascade-deleted`).toBe(true);
    }
  });

  it('keeps timelines out of the closure', () => {
    // A timeline is the user's edit, not derived media data: its clips survive
    // with the refs unset and meta.mediaMissing flagged (hook-media-delete).
    expect(closure.has('TimelineClips')).toBe(false);
    expect(closure.has('Timelines')).toBe(false);
    expect(closure.has('TimelineTracks')).toBe(false);
  });

  it('has no required non-cascade reference into the closure', () => {
    // Positive control: an empty result below only means something if the
    // scan can see required non-cascade edges at all. Media.UploadRef is one —
    // and the reason hook-media-delete deletes the Upload AFTER the Media
    // (reverse FK, so no cascade can express it) and only when no other Media
    // still points at it.
    expect(
      edges.some(
        (edge) =>
          edge.from === 'Media' &&
          edge.field === 'UploadRef' &&
          edge.required &&
          !edge.cascadeDelete
      )
    ).toBe(true);

    // The invariant. Anything listed here makes `DELETE /api/collections/Media`
    // fail with "part of a required reference"; fix it by making the field
    // optional (the reference is then unset) or cascading it (the referring
    // row is then deleted too) — never by leaving it required.
    const blockers = edges
      .filter(
        (edge) => closure.has(edge.to) && edge.required && !edge.cascadeDelete
      )
      .map((edge) => `${edge.from}.${edge.field} -> ${edge.to}`);

    expect(blockers).toEqual([]);
  });

  it('leaves the four relaxed label refs optional', () => {
    // Regression pins for the fields the bug report hit. LabelEntity rows are
    // also deleted on their own (hook-label-entity-gc, and legacy rows shared
    // across media), so these must UNSET rather than cascade — cascading would
    // let one media's delete destroy another media's detections.
    for (const [from, field] of [
      ['LabelFaces', 'LabelEntityRef'],
      ['LabelObjects', 'LabelEntityRef'],
      ['LabelPerson', 'LabelEntityRef'],
      ['LabelPerson', 'LabelTrackRef'],
    ]) {
      const edge = edges.find((e) => e.from === from && e.field === field);
      expect(edge, `${from}.${field} is missing`).toBeDefined();
      expect(edge?.required, `${from}.${field} must not be required`).toBe(
        false
      );
      expect(edge?.cascadeDelete, `${from}.${field} must not cascade`).toBe(
        false
      );
    }
  });
});
