/**
 * SERVER-ONLY entrypoint: imports Node built-ins (fs, stream) and the AWS
 * SDK. Browser bundles resolve `@project/shared/storage` to
 * ./browser-stub.ts via the `browser` condition in package.json `exports`,
 * so importing this from client code throws at module evaluation.
 * Browser-safety of all other entrypoints is enforced by
 * src/__tests__/browser-safety.test.ts.
 */
import { StorageBackendType } from '../enums';
import { LocalStorageBackend } from './local-backend';
import { S3StorageBackend } from './s3-backend';
import type { StorageBackend, StorageConfig } from './types';

/**
 * Create a storage backend instance based on configuration
 * @param config - Storage configuration
 * @returns Initialized storage backend
 */
export async function createStorageBackend(
  config: StorageConfig
): Promise<StorageBackend> {
  let backend: StorageBackend;

  switch (config.type) {
    case StorageBackendType.LOCAL:
      if (!config.local) {
        throw new Error('Local storage configuration is required');
      }
      backend = new LocalStorageBackend(config.local);
      break;

    case StorageBackendType.S3:
      if (!config.s3) {
        throw new Error('S3 storage configuration is required');
      }
      backend = new S3StorageBackend(config.s3);
      break;

    default:
      throw new Error(`Unknown storage backend type: ${config.type}`);
  }

  // Initialize the backend (validate permissions, test connectivity, etc.)
  await backend.initialize();

  return backend;
}

// Re-export types and implementations
export * from './types';
export { resolveLocalStorageBasePath } from './base-path';
export { LocalStorageBackend } from './local-backend';
export { S3StorageBackend } from './s3-backend';
