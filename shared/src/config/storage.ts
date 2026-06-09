import { StorageBackendType } from '../enums';
import { StorageConfig } from '../storage/types';

/**
 * Environment variables for storage configuration
 */
export interface StorageEnvironment {
  STORAGE_TYPE?: string;

  // S3 storage config
  STORAGE_S3_ENDPOINT?: string;
  STORAGE_S3_BUCKET?: string;
  STORAGE_S3_REGION?: string;
  STORAGE_S3_ACCESS_KEY_ID?: string;
  STORAGE_S3_SECRET_ACCESS_KEY?: string;
  STORAGE_S3_FORCE_PATH_STYLE?: string;
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
    // Use WORKER_DATA_DIR if set (e.g. /data/storage in Docker), otherwise fall back
    // to relative 'data' for local development.
    // Keep this module client-safe: do not resolve paths here (no fs/path).
    // Server-side backends will resolve relative paths against a sensible project root.
    const basePath = process.env.WORKER_DATA_DIR || 'data';
    return {
      type: StorageBackendType.LOCAL,
      local: { basePath },
    };
  }

  if (backend === StorageBackendType.S3) {
    const endpoint = process.env.STORAGE_S3_ENDPOINT;
    const bucket = process.env.STORAGE_S3_BUCKET;
    const region = process.env.STORAGE_S3_REGION || 'us-east-1';
    const accessKeyId = process.env.STORAGE_S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.STORAGE_S3_SECRET_ACCESS_KEY;

    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'STORAGE_S3_ENDPOINT, STORAGE_S3_BUCKET, STORAGE_S3_ACCESS_KEY_ID, and STORAGE_S3_SECRET_ACCESS_KEY are required when STORAGE_TYPE=s3'
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
        forcePathStyle: process.env.STORAGE_S3_FORCE_PATH_STYLE === 'true',
      },
    };
  }

  throw new Error(`Unknown storage backend: ${backend}`);
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
    (process.env.STORAGE_TYPE as StorageBackendType) || StorageBackendType.LOCAL
  );
}
