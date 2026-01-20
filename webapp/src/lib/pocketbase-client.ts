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

function resolveUrl(): string {
  // Next.js embeds NEXT_PUBLIC_* vars at build time
  const url =
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

export default pb;
