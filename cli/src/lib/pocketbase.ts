import PocketBase from 'pocketbase';
import type { TypedPocketBase } from '@project/shared';
import { loadConfig } from './config.js';
import { apiFetch } from './http.js';

/** Raised when a command needs auth but no valid cached token exists. */
export class NotAuthenticatedError extends Error {
  constructor() {
    super('Not authenticated. Run `vw login` first.');
    this.name = 'NotAuthenticatedError';
  }
}

/**
 * Resolve the PocketBase URL: explicit override → cached config → env
 * (POCKETBASE_URL) → localhost default.
 */
export function resolveUrl(override?: string): string {
  if (override) return override;
  const cfg = loadConfig();
  if (cfg.url) return cfg.url;
  return process.env.POCKETBASE_URL ?? 'http://localhost:8090';
}

/** Build a bare (unauthenticated) PocketBase client. */
export function createClient(url?: string): TypedPocketBase {
  const pb = new PocketBase(resolveUrl(url)) as unknown as TypedPocketBase;
  pb.autoCancellation(false);
  // Route all SDK traffic through the CLI's HTTP/1.1 agent (see http.ts) —
  // Node's default fetch may negotiate HTTP/2, which proxies like the
  // Cloudflare edge throttle with ENHANCE_YOUR_CALM stream resets.
  pb.beforeSend = (url, options) => {
    options.fetch = apiFetch;
    return { url, options };
  };
  return pb;
}

/**
 * Build a client with the cached auth token restored and validated via
 * authRefresh. Throws NotAuthenticatedError when no/expired token is present.
 */
export async function getAuthedClient(
  urlOverride?: string
): Promise<TypedPocketBase> {
  const cfg = loadConfig();
  const pb = createClient(urlOverride ?? cfg.url);

  if (!cfg.token) {
    throw new NotAuthenticatedError();
  }

  // Restore the token; authRefresh repopulates the full auth record.
  pb.authStore.save(
    cfg.token,
    cfg.userId
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ id: cfg.userId, collectionName: 'Users' } as any)
      : null
  );

  try {
    await pb.collection('Users').authRefresh();
  } catch {
    throw new NotAuthenticatedError();
  }

  return pb;
}
