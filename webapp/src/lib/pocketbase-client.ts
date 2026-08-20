'use client';

/**
 * Client-side PocketBase client
 *
 * Use this for Client Components ('use client') and browser-side code.
 * Never use in server-side code - use '@/lib/pocketbase-server' instead.
 */
import PocketBase from 'pocketbase';
import type { TypedPocketBase } from '@project/shared/types';
import { env } from '@project/shared/env';
import { readRuntimeConfig } from '@/lib/runtime-config';

export function resolveUrl(): string {
  const url =
    // Runtime override, injected by the server (`PUBLIC_POCKETBASE_URL`).
    // Wins because it is the only tier an operator can change without a
    // rebuild; absent it, the tiers below behave exactly as they always have.
    readRuntimeConfig()?.pocketbaseUrl ||
    // Next.js embeds NEXT_PUBLIC_* vars at build time
    (typeof process !== 'undefined' &&
      process.env?.NEXT_PUBLIC_POCKETBASE_URL) ||
    env.NEXT_PUBLIC_POCKETBASE_URL;

  // Resolve relative paths to current origin (for nginx routing)
  if (!url.startsWith('http')) {
    return typeof window !== 'undefined'
      ? `${window.location.origin}${url}`
      : url;
  }

  return url;
}

const pb = new PocketBase(resolveUrl()) as TypedPocketBase;
pb.autoCancellation(false);

/**
 * Re-point the singleton at the currently resolvable URL.
 *
 * The URL above is fixed at module load. Next's bundle chunks are emitted as
 * <script async> and React hoists them above the layout's inline
 * runtime-config script, so a chunk CAN execute first and construct the
 * singleton before the override exists. `PocketBaseProvider` calls this once,
 * above every consumer, to close that window — nothing touches `pb` at module
 * scope, so no request can have gone out on the stale URL by then.
 *
 * Idempotent, and a no-op when nothing is configured: `resolveUrl()` then
 * returns exactly what the constructor was given.
 */
export function syncBaseUrl(): void {
  const url = resolveUrl();
  if (pb.baseURL !== url) pb.baseURL = url;
}

export default pb;
