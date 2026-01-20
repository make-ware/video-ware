import { StorageBackendType } from '../enums';

/**
 * Configuration for local filesystem storage
 */
export interface LocalStorageConfig {
  basePath: string;
}

/**
 * Configuration for S3-compatible storage
 */
export interface S3StorageConfig {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean; // For MinIO compatibility
}

/**
 * Combined storage configuration
 */
export interface StorageConfig {
  type: StorageBackendType;
  local?: LocalStorageConfig;
  s3?: S3StorageConfig;
}

/**
 * Result of a storage upload operation
 */
export interface StorageResult {
  path: string;
  size: number;
  etag?: string;
  lastModified?: Date;
}

/**
 * Represents a file in storage
 */
export interface StorageFile {
  key: string;
  size: number;
  etag: string;
  lastModified: Date;
}

/**
 * Presigned URL for direct uploads
 */
export interface PresignedUrl {
  url: string;
  fields?: Record<string, string>; // For POST-based uploads
  expiresAt: Date;
}

/**
 * Upload progress tracking
 */
export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
  speed: number; // bytes per second
  estimatedTimeRemaining: number; // seconds
}

/**
 * Configuration for S3 directory watcher
 */
export interface WatcherConfig {
  enabled: boolean;
  prefix: string;
  workspaceId: string;
  intervalSeconds: number;
  reprocessModified: boolean;
}

/**
 * Storage backend interface - all storage implementations must implement this
 */
export interface StorageBackend {
  readonly type: StorageBackendType;

  /**
   * Initialize the storage backend and validate configuration
   * Should be called before using any other methods
   */
  initialize(): Promise<void>;

  /**
   * Upload a file to storage
   * @param file - File, Buffer, or ReadableStream to upload
   * @param path - Destination path in storage
   * @param onProgress - Optional progress callback
   * @returns Storage result with path and metadata
   */
  upload(
    file: File | Buffer | ReadableStream,
    path: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<StorageResult>;

  /**
   * Upload a chunk of a file (for chunked uploads)
   * @param chunk - ReadableStream of the chunk data
   * @param path - Destination path in storage
   * @param chunkIndex - Index of this chunk (0-based)
   * @param totalChunks - Total number of chunks
   * @param isFirstChunk - Whether this is the first chunk
   * @param isLastChunk - Whether this is the last chunk
   * @returns Storage result (only on last chunk)
   */
  uploadChunk(
    chunk: ReadableStream,
    path: string,
    chunkIndex: number,
    totalChunks: number,
    isFirstChunk: boolean,
    isLastChunk: boolean
  ): Promise<StorageResult | void>;

  /**
   * Download a file from storage
   * @param path - Path to the file in storage
   * @returns ReadableStream of file contents
   */
  download(path: string): Promise<ReadableStream>;

  /**
   * Delete a file from storage
   * @param path - Path to the file to delete
   */
  delete(path: string): Promise<void>;

  /**
   * Check if a file exists in storage
   * @param path - Path to check
   * @returns true if file exists
   */
  exists(path: string): Promise<boolean>;

  /**
   * Get a URL to access the file
   * @param path - Path to the file
   * @param expirySeconds - Optional expiry time for signed URLs
   * @returns URL to access the file
   */
  getUrl(path: string, expirySeconds?: number): Promise<string>;

  /**
   * List files in storage with a given prefix
   * @param prefix - Prefix to filter files
   * @returns Array of storage files
   */
  listFiles(prefix: string): Promise<StorageFile[]>;

  /**
   * Get a presigned URL for direct browser uploads (S3 only)
   * @param path - Destination path for the upload
   * @param contentType - MIME type of the file
   * @param maxSize - Maximum file size in bytes
   * @param expirySeconds - URL expiry time in seconds
   * @returns Presigned URL details
   */
  getPresignedUploadUrl(
    path: string,
    contentType: string,
    maxSize: number,
    expirySeconds?: number
  ): Promise<PresignedUrl>;
}

/**
 * Generate a storage path for an upload
 * @param workspaceId - Workspace ID
 * @param uploadId - Upload ID
 * @param extension - File extension
 * @returns Storage path
 */
export function generateStoragePath(
  workspaceId: string,
  uploadId: string,
  extension: string
): string {
  return `uploads/${workspaceId}/${uploadId}/original.${extension}`;
}

/**
 * Generate a local filesystem path for an upload
 * @param basePath - Base storage directory
 * @param workspaceId - Workspace ID
 * @param uploadId - Upload ID
 * @param extension - File extension
 * @returns Full filesystem path
 */
export function generateLocalPath(
  basePath: string,
  workspaceId: string,
  uploadId: string,
  extension: string
): string {
  return `${basePath}/uploads/${workspaceId}/${uploadId}/original.${extension}`;
}
