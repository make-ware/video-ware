import { StorageBackendType } from '../enums';
import { StorageConfig, WatcherConfig } from '../storage/types';

/**
 * Environment variables for storage configuration
 */
export interface StorageEnvironment {
  STORAGE_TYPE?: string;

  // S3 storage config
  S3_ENDPOINT?: string;
  S3_BUCKET?: string;
  S3_REGION?: string;
  S3_ACCESS_KEY?: string;
  S3_SECRET_KEY?: string;
  S3_FORCE_PATH_STYLE?: string;

  // S3 Watcher config (optional)
  ENABLE_S3_WATCHER?: string;
  S3_WATCH_PREFIX?: string;
  S3_WATCH_WORKSPACE_ID?: string;
  S3_WATCH_INTERVAL_SECONDS?: string;
  S3_WATCH_REPROCESS_MODIFIED?: string;
}

/**
 * Load storage configuration from environment variables
 * @throws Error if required configuration is missing
 * @returns StorageConfig object
 */
export function loadStorageConfig(): StorageConfig {
  const backend =
    (process.env.STORAGE_TYPE as StorageBackendType) ||
    StorageBackendType.LOCAL;

  if (backend === StorageBackendType.LOCAL) {
    // Keep this module client-safe: do not resolve paths here (no fs/path).
    // Server-side backends will resolve relative paths against a sensible project root.
    const basePath = 'data';
    return {
      type: StorageBackendType.LOCAL,
      local: { basePath },
    };
  }

  if (backend === StorageBackendType.S3) {
    const endpoint = process.env.S3_ENDPOINT;
    const bucket = process.env.S3_BUCKET;
    const region = process.env.S3_REGION || 'us-east-1';
    const accessKeyId = process.env.S3_ACCESS_KEY;
    const secretAccessKey = process.env.S3_SECRET_KEY;

    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, and S3_SECRET_KEY are required when STORAGE_TYPE=s3'
      );
    }

    return {
      type: StorageBackendType.S3,
      s3: {
        endpoint,
        bucket,
        region,
        accessKeyId,
        secretAccessKey,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      },
    };
  }

  throw new Error(`Unknown storage backend: ${backend}`);
}

/**
 * Load S3 watcher configuration from environment variables
 * @returns WatcherConfig if enabled, null otherwise
 * @throws Error if watcher is enabled but required configuration is missing
 */
export function loadWatcherConfig(): WatcherConfig | null {
  if (process.env.ENABLE_S3_WATCHER !== 'true') {
    return null;
  }

  const prefix = process.env.S3_WATCH_PREFIX;
  const workspaceId = process.env.S3_WATCH_WORKSPACE_ID;

  if (!prefix || !workspaceId) {
    throw new Error(
      'S3_WATCH_PREFIX and S3_WATCH_WORKSPACE_ID are required when ENABLE_S3_WATCHER=true'
    );
  }

  return {
    enabled: true,
    prefix,
    workspaceId,
    intervalSeconds: parseInt(
      process.env.S3_WATCH_INTERVAL_SECONDS || '60',
      10
    ),
    reprocessModified: process.env.S3_WATCH_REPROCESS_MODIFIED === 'true',
  };
}

/**
 * Validate that all required storage configuration is present
 * @throws Error if configuration is invalid
 */
export function validateStorageConfig(): void {
  // This will throw if configuration is invalid
  loadStorageConfig();
}

/**
 * Get the default storage backend type
 * @returns The configured storage backend type or LOCAL as default
 */
export function getStorageBackendType(): StorageBackendType {
  return (
    (process.env.STORAGE_TYPE as StorageBackendType) ||
    StorageBackendType.LOCAL
  );
}
