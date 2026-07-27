// Keeping already-persisted label rows pointed at the right LabelEntity.

/** A persisted label row that carries a link to its LabelEntity. */
export interface EntityLinkedRow {
  id: string;
  LabelEntityRef?: string;
}

/** The slice of a mutator `relinkEntityRef` needs. */
export interface EntityLinkedMutator<T extends EntityLinkedRow> {
  update(id: string, input: Partial<T>): Promise<T>;
}

/**
 * Point an already-persisted row at the LabelEntity this run resolved, when
 * the two disagree.
 *
 * Label rows are upserted by content hash, so a re-run finds its rows already
 * there and would otherwise reuse them untouched. That is wrong whenever the
 * *entity* changed under a stable hash — which is exactly what the move to
 * per-instance entities did: rows written earlier still point at the old
 * shared-by-name LabelEntity, and re-running the labels task is the documented
 * repair path. Without this the stale ref is pinned forever, since nothing
 * else ever rewrites it.
 *
 * A no-op when the row is already correct, so the common re-run costs no
 * writes. Errors propagate: the caller's insert loop already logs and accounts
 * for a row it could not write.
 *
 * @returns true when a write was issued
 */
export async function relinkEntityRef<T extends EntityLinkedRow>(
  mutator: EntityLinkedMutator<T>,
  existing: T,
  entityId: string
): Promise<boolean> {
  if (!entityId || existing.LabelEntityRef === entityId) {
    return false;
  }

  await mutator.update(existing.id, {
    LabelEntityRef: entityId,
  } as Partial<T>);

  return true;
}
