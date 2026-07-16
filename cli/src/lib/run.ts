import {
  RecordConflictError,
  RecordGoneError,
  type TypedPocketBase,
} from '@project/shared';
import { getAuthedClient, NotAuthenticatedError } from './pocketbase.js';
import { fail } from './output.js';

/**
 * Return an authenticated client, or exit with a friendly message when the
 * user has not logged in / the session expired.
 */
export async function requireClient(
  urlOverride?: string
): Promise<TypedPocketBase> {
  try {
    return await getAuthedClient(urlOverride);
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      fail(err.message);
    }
    throw err;
  }
}

/** Print an error and exit non-zero. */
export function handleError(err: unknown): never {
  if (err instanceof RecordGoneError) {
    fail(
      `${err.message} — another editor may have deleted it; check the ` +
        'timeline with `vw timeline doctor <timelineId>`.'
    );
  }
  if (err instanceof RecordConflictError) {
    fail(
      `${err.message} — re-run the command (it re-plans against the fresh ` +
        'state), or pass --force.'
    );
  }
  fail(err instanceof Error ? err.message : String(err));
}
