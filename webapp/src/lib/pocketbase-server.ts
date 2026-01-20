/**
 * Server-side PocketBase client
 */
import 'server-only';

import PocketBase from 'pocketbase';
import type { TypedPocketBase } from '@project/shared/types';
import { env } from '@project/shared/env';

/**
 * Create a new PocketBase client for server-side usage.
 *
 * Use this in API routes or Server Actions to create a fresh instance
 * per request, avoiding auth state sharing between requests.
 *
 * @example
 * ```ts
 * // app/api/example/route.ts
 * import { createServerPocketBaseClient } from '@/lib/pocketbase-server';
 *
 * export async function GET() {
 *   const pb = createServerPocketBaseClient();
 *   // Use pb for this request only
 * }
 * ```
 */
export function createServerPocketBaseClient(): TypedPocketBase {
  const pb = new PocketBase(env.POCKETBASE_URL) as TypedPocketBase;
  pb.autoCancellation(false);
  return pb;
}

/**
 * Authenticate PocketBase client with the user's token from the request.
 * Extracts the token from the Authorization header and verifies it.
 *
 * @param pb PocketBase client instance
 * @param req Request object to extract Authorization header from
 * @throws Error if token is missing or invalid
 *
 * @example
 * ```ts
 * // app/api/example/route.ts
 * import { createServerPocketBaseClient, authenticateAsUser } from '@/lib/pocketbase-server';
 *
 * export async function GET(req: Request) {
 *   const pb = createServerPocketBaseClient();
 *   await authenticateAsUser(pb, req);
 *   // pb is now authenticated as the requesting user
 * }
 * ```
 */
export async function authenticateAsUser(
  pb: PocketBase,
  req: Request
): Promise<void> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    throw new Error('Missing Authorization header');
  }

  // Extract token from "Bearer <token>" format
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) {
    throw new Error(
      'Invalid Authorization header format. Expected: Bearer <token>'
    );
  }

  const token = match[1];

  // Set the token on the authStore
  // PocketBase will validate it on the next request
  pb.authStore.save(token, null);

  // Verify the token is valid by refreshing the auth
  // This will throw if the token is invalid or expired
  try {
    await pb.collection('Users').authRefresh();
  } catch {
    pb.authStore.clear();
    throw new Error('Invalid or expired authentication token');
  }
}
