import 'server-only';

import {
  createStorageBackend,
  type StorageBackend,
  type StorageConfig,
} from '@project/shared/storage';
import { loadStorageConfig } from '@project/shared/config';

/**
 * Process-wide storage backend cache.
 *
 * The chunked upload/replace routes handle each chunk as a separate request;
 * creating a backend per request meant re-running initialize() every time —
 * for S3 that is a ListObjects round trip and a fresh client (new TLS
 * connection pool) PER CHUNK. Caching keeps one warm client whose pooled
 * connections are reused across all chunks.
 *
 * Cached as a promise so concurrent chunks share one in-flight
 * initialization; a failed initialization clears the cache so the next
 * request retries instead of being stuck with a poisoned backend.
 */
let cached: { key: string; backend: Promise<StorageBackend> } | null = null;

function configKey(config: StorageConfig): string {
  // Env-derived config is a small plain object; JSON is a stable-enough key
  // (it only changes when the env changes, which requires a redeploy anyway).
  return JSON.stringify(config);
}

export function getStorageBackend(
  config: StorageConfig = loadStorageConfig()
): Promise<StorageBackend> {
  const key = configKey(config);
  if (cached && cached.key === key) {
    return cached.backend;
  }
  const backend = createStorageBackend(config).catch((error) => {
    if (cached?.key === key) {
      cached = null;
    }
    throw error;
  });
  cached = { key, backend };
  return backend;
}
