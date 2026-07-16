import { Agent, fetch as undiciFetch } from 'undici';

/**
 * All CLI HTTP traffic runs through explicit undici agents pinned to
 * HTTP/1.1 (`allowH2: false`). Node's global fetch can negotiate HTTP/2,
 * where reverse proxies answer long upload batches with
 * `NGHTTP2_ENHANCE_YOUR_CALM` stream resets — and the poisoned session then
 * stays in the connection pool, so every retry fails instantly. HTTP/1.1
 * sidesteps that failure mode entirely, and `resetUploadConnections` lets
 * the chunk retry loop discard suspect connections between attempts.
 *
 * `keepAliveTimeout` is kept short so pooled sockets don't hold the process
 * open after a command finishes.
 */

type FetchInit = Parameters<typeof undiciFetch>[1];

/** For short JSON requests (PocketBase API, downloads): undici's default
 * request timers stay on as a backstop against a hung server. */
const apiAgent = new Agent({ allowH2: false, keepAliveTimeout: 1000 });

/** For chunk PUTs: every request is bounded by the caller's AbortSignal, and
 * a 100MB chunk on a slow uplink can legitimately exceed undici's default
 * 5-minute headers timeout, so the agent's own timers are disabled. */
function makeUploadAgent(): Agent {
  return new Agent({
    allowH2: false,
    keepAliveTimeout: 1000,
    headersTimeout: 0,
    bodyTimeout: 0,
  });
}

let uploadAgent = makeUploadAgent();

/** Drop-in `fetch` for API traffic; matches PocketBase's SendOptions.fetch. */
export function apiFetch(
  url: RequestInfo | URL,
  config?: RequestInit
): Promise<Response> {
  return undiciFetch(url as string | URL, {
    ...(config as FetchInit),
    dispatcher: apiAgent,
  }) as unknown as Promise<Response>;
}

/** `fetch` for upload chunk PUTs (no agent-level timeouts — see above). */
export function uploadFetch(
  url: string,
  init: RequestInit
): Promise<Response> {
  return undiciFetch(url, {
    ...(init as FetchInit),
    dispatcher: uploadAgent,
  }) as unknown as Promise<Response>;
}

/**
 * Discard the upload agent's pooled connections and start fresh. Called
 * between chunk retry attempts: a retry on the connection that just failed
 * tends to fail the same way (a reset or rate-limited socket is served
 * straight from the pool), while a new connection gets a clean slate.
 */
export function resetUploadConnections(): void {
  void uploadAgent.destroy().catch(() => undefined);
  uploadAgent = makeUploadAgent();
}
