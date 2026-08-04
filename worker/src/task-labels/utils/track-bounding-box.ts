// Filling in a persisted track's union bounding box.

import type { Bbox } from '@project/shared';

/** A persisted LabelTrack row, as far as the box heal is concerned. */
export interface BoxedTrackRow {
  id: string;
  boundingBox?: unknown;
}

/** The slice of a mutator `healBoundingBox` needs. */
export interface BoxedTrackMutator<T extends BoxedTrackRow> {
  update(id: string, input: Partial<T>): Promise<T>;
}

/** Whether a stored `boundingBox` value is a usable box. */
function hasBox(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const box = value as Partial<Bbox>;
  return (
    typeof box.left === 'number' &&
    typeof box.top === 'number' &&
    typeof box.right === 'number' &&
    typeof box.bottom === 'number'
  );
}

/**
 * Give an already-persisted track the union box this run computed, when it has
 * none.
 *
 * `boundingBox` was declared long before anything wrote it, so every track
 * ingested before that is sitting on an empty column. Bumping a processor
 * version to re-emit them is not an option — `trackHash` is
 * `sha256(mediaId:trackId:version:processor)`, so a bump would mint a duplicate
 * of every track in the library rather than update one. Healing on the
 * hash-matched path fills them in as media are re-run, at no extra read cost:
 * the row is already in hand.
 *
 * Only fills an EMPTY box. A track whose keyframes changed would have a
 * different hash and take the create path, so a stored box can only disagree
 * with a recomputed one by float noise — and rewriting every row on every
 * re-run to chase that would be pure churn.
 *
 * Errors propagate: the caller's insert loop already logs and accounts for a
 * row it could not write.
 *
 * @returns true when a write was issued
 */
export async function healBoundingBox<T extends BoxedTrackRow>(
  mutator: BoxedTrackMutator<T>,
  existing: T,
  boundingBox: Bbox | undefined
): Promise<boolean> {
  if (!boundingBox || hasBox(existing.boundingBox)) {
    return false;
  }

  await mutator.update(existing.id, { boundingBox } as Partial<T>);
  return true;
}
