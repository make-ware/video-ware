/**
 * Optimistic-concurrency primitives for record updates.
 *
 * PocketBase writes are last-write-wins: a plain PATCH carries no version or
 * timestamp precondition, so two editors (webapp and CLI, or two CLI runs)
 * can silently clobber each other's fields — worst on whole-JSON columns
 * like `TimelineClips.meta`, where a concurrent gain edit and segment edit
 * drop each other's keys. `BaseMutator.updateWithGuard` uses these types to
 * detect that the record changed since it was read and abort before writing.
 */

export interface RecordConflictInfo {
  collection: string;
  recordId: string;
  /** `updated` value from the read the patch was computed from. */
  expectedUpdated: string;
  /** `updated` value stored now. */
  actualUpdated: string;
  /** Top-level fields whose stored values differ from the reader's snapshot. */
  changedFields: string[];
}

/** The record changed since it was read; the pending patch was NOT written. */
export class RecordConflictError extends Error {
  readonly info: RecordConflictInfo;

  constructor(info: RecordConflictInfo) {
    const changed =
      info.changedFields.length > 0
        ? ` (remote changed: ${info.changedFields.join(', ')})`
        : '';
    super(
      `${info.collection} record ${info.recordId} changed since it was read${changed}`
    );
    this.name = 'RecordConflictError';
    this.info = info;
  }
}

/** The record no longer exists; it was deleted after being read. */
export class RecordGoneError extends Error {
  readonly collection: string;
  readonly recordId: string;

  constructor(collection: string, recordId: string) {
    super(
      `${collection} record ${recordId} no longer exists — it was deleted after being read`
    );
    this.name = 'RecordGoneError';
    this.collection = collection;
    this.recordId = recordId;
  }
}

/** Fields that always differ or never carry user intent — not conflicts. */
const DIFF_SKIP_FIELDS = new Set([
  'created',
  'updated',
  'expand',
  'collectionId',
  'collectionName',
]);

/**
 * Top-level fields of `snapshot` whose values differ in `current`
 * (JSON-compared, so nested objects like `meta` count as one field).
 * Powers the "remote changed: start, end" part of a conflict report.
 */
export function diffTopLevelFields(
  snapshot: Record<string, unknown>,
  current: Record<string, unknown>
): string[] {
  return Object.keys(snapshot)
    .filter((key) => !DIFF_SKIP_FIELDS.has(key))
    .filter(
      (key) =>
        JSON.stringify(snapshot[key] ?? null) !==
        JSON.stringify(current[key] ?? null)
    );
}
