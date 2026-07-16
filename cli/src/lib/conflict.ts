import { RecordConflictError } from '@project/shared';
import { info } from './output.js';
import { staleReadWarning, type OpWarning } from './warnings.js';

/**
 * Concurrent-edit handling for CLI edit commands.
 *
 * Edit ops read the records they touch, plan in memory, then write with an
 * optimistic guard (BaseMutator.updateWithGuard) on the primary record. When
 * the guard trips — the record changed between the read and the write — the
 * safe response depends on WHAT changed remotely:
 *
 * - Disjoint fields (or --force): the op is a pure planner over fresh reads,
 *   so simply re-running it re-plans correctly. One automatic retry, tagged
 *   with a stale-read warning so the caller knows it happened.
 * - The same fields this op patches (or `meta`, which PocketBase replaces
 *   whole, so ANY concurrent meta write would be clobbered): abort before
 *   writing — proceeding would silently discard the other editor's change.
 */
export interface ConflictRetryOptions {
  /** Top-level fields this op patches on its primary record. */
  patchKeys: string[];
  /** --force: retry (re-planning on fresh state) even on contested fields. */
  force?: boolean;
}

export async function withConflictRetry<R extends { warnings?: OpWarning[] }>(
  run: () => Promise<R>,
  opts: ConflictRetryOptions
): Promise<R> {
  try {
    return await run();
  } catch (err) {
    if (!(err instanceof RecordConflictError)) throw err;
    const contested = err.info.changedFields.filter(
      (field) => opts.patchKeys.includes(field) || field === 'meta'
    );
    if (contested.length > 0 && !opts.force) {
      throw new Error(
        `${err.message} — the concurrent edit touched the same field(s) ` +
          `(${contested.join(', ')}). Inspect the record and re-run, or ` +
          'pass --force to re-apply this command over the fresh state.'
      );
    }
    info(
      `note: ${err.info.collection} record ${err.info.recordId} changed ` +
        'concurrently — re-planning against fresh state'
    );
    // Fresh run = fresh reads = fresh guard snapshot; a second conflict
    // means sustained concurrent editing and propagates as a hard error.
    const result = await run();
    result.warnings?.unshift(staleReadWarning(err.info.recordId));
    return result;
  }
}
